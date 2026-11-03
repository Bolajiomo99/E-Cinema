package httpapi

import (
	"net/http"
	"slices"
	"sync"
	"time"
)

// latency keeps how long the last API requests took, for the Infrastructure page's p99 (Figma 50:469).
// It lives in memory, so it covers this instance since its last restart.
type latency struct {
	mu   sync.Mutex
	ring [4096]time.Duration
	n    int // requests seen
}

func (l *latency) add(d time.Duration) {
	l.mu.Lock()
	l.ring[l.n%len(l.ring)] = d
	l.n++
	l.mu.Unlock()
}

// percentiles returns p50 and p99 in milliseconds and how many requests they cover.
func (l *latency) percentiles() (p50, p99 float64, n int) {
	l.mu.Lock()
	n = min(l.n, len(l.ring))
	xs := slices.Clone(l.ring[:n])
	l.mu.Unlock()
	if n == 0 {
		return 0, 0, 0
	}
	slices.Sort(xs)
	at := func(q float64) float64 { return float64(xs[min(n-1, int(q*float64(n)))]) / float64(time.Millisecond) }
	return at(0.50), at(0.99), n
}

func (l *latency) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "" { // websockets stay open for minutes; they are not request latency
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		next.ServeHTTP(w, r)
		if r.URL.Path != "/healthz" {
			l.add(time.Since(start))
		}
	})
}
