package identity_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Bolajiomo99/E-Cinema/api/internal/identity"
)

func fake(t *testing.T, review string) identity.Sumsub {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mac := hmac.New(sha256.New, []byte("secret"))
		mac.Write([]byte(r.Header.Get("X-App-Access-Ts") + r.Method + r.URL.RequestURI()))
		mac.Write(body)
		if r.Header.Get("X-App-Token") != "app" || r.Header.Get("X-App-Access-Sig") != hex.EncodeToString(mac.Sum(nil)) {
			http.Error(w, `{"description":"bad signature"}`, http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/resources/accessTokens/sdk":
			w.Write([]byte(`{"token":"_act-sbx-123","userId":"u1"}`))
		case review == "":
			http.Error(w, `{"description":"not found"}`, http.StatusNotFound)
		default:
			w.Write([]byte(review))
		}
	}))
	t.Cleanup(srv.Close)
	return identity.Sumsub{BaseURL: srv.URL, AppToken: "app", SecretKey: "secret", Level: "basic-kyc-level"}
}

func TestSDKTokenSigned(t *testing.T) {
	tok, err := fake(t, "").SDKToken(context.Background(), "u1")
	if err != nil || tok != "_act-sbx-123" {
		t.Fatalf("%v %q", err, tok)
	}
}

func TestCheckOutcomes(t *testing.T) {
	cases := map[string]string{
		`{"review":{"reviewStatus":"init"}}`:                                                                                                    "pending",
		`{"review":{"reviewStatus":"completed","reviewResult":{"reviewAnswer":"GREEN"}}}`:                                                       "approved",
		`{"review":{"reviewStatus":"completed","reviewResult":{"reviewAnswer":"RED","reviewRejectType":"RETRY"}}}`:                              "retry",
		`{"review":{"reviewStatus":"completed","reviewResult":{"reviewAnswer":"RED","reviewRejectType":"FINAL","rejectLabels":["DUPLICATE"]}}}`: "rejected",
	}
	for body, want := range cases {
		got, err := fake(t, body).Check(context.Background(), "u1")
		if err != nil || got.Status != want {
			t.Errorf("%s: got %+v %v, want %s", body, got, err, want)
		}
	}
	if _, err := fake(t, "").Check(context.Background(), "u1"); !errors.Is(err, identity.ErrNoApplicant) {
		t.Fatalf("want ErrNoApplicant, got %v", err)
	}
}
