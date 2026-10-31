// Package identity runs face (liveness) and ID checks through Sumsub.
package identity

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrNoApplicant = errors.New("no identity check started yet")

type Sumsub struct {
	BaseURL   string // https://api.sumsub.com
	AppToken  string
	SecretKey string
	Level     string // verification level set up in the Sumsub dashboard
	Client    *http.Client
}

// Result is the outcome of a check: Status is "pending", "approved", "retry" or "rejected".
type Result struct {
	Status  string   `json:"status"`
	Labels  []string `json:"labels,omitempty"`
	Comment string   `json:"comment,omitempty"`
}

func (s Sumsub) do(ctx context.Context, method, path string, body any, out any) (int, error) {
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(s.SecretKey))
	mac.Write([]byte(ts + method + path))
	mac.Write(raw)
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(s.BaseURL, "/")+path, bytes.NewReader(raw))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-App-Token", s.AppToken)
	req.Header.Set("X-App-Access-Ts", ts)
	req.Header.Set("X-App-Access-Sig", hex.EncodeToString(mac.Sum(nil)))
	c := s.Client
	if c == nil {
		c = &http.Client{Timeout: 15 * time.Second}
	}
	res, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode/100 != 2 {
		return res.StatusCode, fmt.Errorf("sumsub %s %d: %.300s", path, res.StatusCode, data)
	}
	return res.StatusCode, json.Unmarshal(data, out)
}

// SDKToken returns a short-lived token for the browser Web SDK, tied to our account id.
func (s Sumsub) SDKToken(ctx context.Context, accountID string) (string, error) {
	var out struct {
		Token string `json:"token"`
	}
	_, err := s.do(ctx, http.MethodPost, "/resources/accessTokens/sdk",
		map[string]any{"userId": accountID, "levelName": s.Level, "ttlInSecs": 1200}, &out)
	return out.Token, err
}

// Check reads the review result of the account's applicant.
func (s Sumsub) Check(ctx context.Context, accountID string) (Result, error) {
	var out struct {
		Review struct {
			ReviewStatus string `json:"reviewStatus"`
			ReviewResult struct {
				ReviewAnswer      string   `json:"reviewAnswer"`
				ReviewRejectType  string   `json:"reviewRejectType"`
				RejectLabels      []string `json:"rejectLabels"`
				ModerationComment string   `json:"moderationComment"`
			} `json:"reviewResult"`
		} `json:"review"`
	}
	code, err := s.do(ctx, http.MethodGet, "/resources/applicants/-;externalUserId="+url.PathEscape(accountID)+"/one", nil, &out)
	if code == http.StatusNotFound {
		return Result{}, ErrNoApplicant
	}
	if err != nil {
		return Result{}, err
	}
	r := out.Review.ReviewResult
	res := Result{Status: "pending", Labels: r.RejectLabels, Comment: r.ModerationComment}
	if out.Review.ReviewStatus == "completed" {
		switch {
		case r.ReviewAnswer == "GREEN":
			res.Status = "approved"
		case r.ReviewRejectType == "RETRY":
			res.Status = "retry"
		default:
			res.Status = "rejected"
		}
	}
	return res, nil
}
