// Package sms sends text messages through Termii.
package sms

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Termii struct {
	BaseURL  string // e.g. https://v3.api.termii.com (from the Termii dashboard)
	APIKey   string
	SenderID string
	Channel  string // "dnd" delivers to Nigerian numbers on Do-Not-Disturb; "generic" otherwise
	Client   *http.Client
}

func (t Termii) Send(ctx context.Context, to, text string) error {
	body, _ := json.Marshal(map[string]string{
		"api_key": t.APIKey,
		"to":      strings.TrimPrefix(to, "+"),
		"from":    t.SenderID,
		"sms":     text,
		"type":    "plain",
		"channel": t.Channel,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(t.BaseURL, "/")+"/api/sms/send", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	c := t.Client
	if c == nil {
		c = &http.Client{Timeout: 10 * time.Second}
	}
	res, err := c.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("termii %d: %s", res.StatusCode, msg)
	}
	return nil
}
