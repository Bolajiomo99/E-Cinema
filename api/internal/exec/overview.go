package exec

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/licensing"
	"github.com/jackc/pgx/v5"
)

// CEO global overview (Figma 117:684): revenue by stream for the last 12 weeks and this month.
// Streams: tickets (seats, pre-orders, gifts, kept films), shop, and licensing (licence fees plus
// royalties owed on partners' recorded sales). 18+ stage payments are left out because they go to
// the charity, church and mosque funds. Plan subscriptions and business deals are not recorded as
// payments yet, so they never appear here as numbers.

type StreamAmount struct {
	Week     string `json:"week,omitempty"` // Monday the week starts, Lagos time
	Stream   string `json:"stream"`
	Currency string `json:"currency"`
	Gross    int64  `json:"gross"` // minor units
}

type OverviewPage struct {
	Weeks        []StreamAmount `json:"weeks"`
	Month        []StreamAmount `json:"month"`
	MembersToday int            `json:"membersToday"`
}

func royaltyCase() string {
	keys := make([]string, 0, len(licensing.Plans))
	for k := range licensing.Plans {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	b.WriteString("CASE l.plan")
	for _, k := range keys {
		fmt.Fprintf(&b, " WHEN '%s' THEN %d", strings.ReplaceAll(k, "'", ""), licensing.Plans[k].RoyaltyPct)
	}
	b.WriteString(" ELSE 0 END")
	return b.String()
}

func (st Store) Overview(ctx context.Context, email string, now time.Time) (OverviewPage, error) {
	p := OverviewPage{Weeks: []StreamAmount{}, Month: []StreamAmount{}}
	if !st.ceo(email) {
		return p, ErrForbidden
	}
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	monday := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos).AddDate(0, 0, -((int(l.Weekday()) + 6) % 7))
	from := monday.AddDate(0, 0, -7*11)
	month := time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, lagos)
	if month.Before(from) {
		from = month
	}
	q := `WITH b AS (` + bookings + `),
	  s AS (
	    SELECT CASE WHEN source IN ('tickets', 'presales', 'gifts', 'library') THEN 'tickets' WHEN source = 'licences' THEN 'licensing' ELSE source END AS stream, cur, gross, at
	    FROM b WHERE source <> 'adult' AND at >= $1 AND at < $2
	    UNION ALL
	    SELECT 'licensing', 'NGN', (x.amount_ngn * 100 * ` + royaltyCase() + ` / 100)::bigint, x.sold_at
	    FROM licence_sales x JOIN brand_licensees l ON l.licence = x.licence WHERE NOT x.returned AND x.sold_at >= $1 AND x.sold_at < $2)
	  SELECT to_char(date_trunc('week', at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM-DD'), at >= $4, stream, cur, sum(gross)::bigint FROM s GROUP BY 1, 2, 3, 4 ORDER BY 1`
	// $3 is the presale cut-off the bookings query expects: seats for screenings still ahead.
	rows, err := st.DB.Query(ctx, q, from, now, now, month)
	if err != nil {
		return p, err
	}
	month2 := map[[2]string]int64{}
	type k3 = [3]string
	weeks := map[k3]int64{}
	for rows.Next() {
		var wk, stream, cur string
		var inMonth bool
		var g int64
		if err := rows.Scan(&wk, &inMonth, &stream, &cur, &g); err != nil {
			rows.Close()
			return p, err
		}
		if wk >= monday.AddDate(0, 0, -7*11).Format("2006-01-02") {
			weeks[k3{wk, stream, cur}] += g
		}
		if inMonth {
			month2[[2]string{stream, cur}] += g
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil && err != pgx.ErrNoRows {
		return p, err
	}
	for k, g := range weeks {
		p.Weeks = append(p.Weeks, StreamAmount{Week: k[0], Stream: k[1], Currency: k[2], Gross: g})
	}
	sort.Slice(p.Weeks, func(i, j int) bool {
		a, b := p.Weeks[i], p.Weeks[j]
		return a.Week+a.Stream+a.Currency < b.Week+b.Stream+b.Currency
	})
	for k, g := range month2 {
		p.Month = append(p.Month, StreamAmount{Stream: k[0], Currency: k[1], Gross: g})
	}
	sort.Slice(p.Month, func(i, j int) bool {
		return p.Month[i].Stream+p.Month[i].Currency < p.Month[j].Stream+p.Month[j].Currency
	})
	err = st.DB.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE created_at >= $1`, time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, lagos)).Scan(&p.MembersToday)
	return p, err
}
