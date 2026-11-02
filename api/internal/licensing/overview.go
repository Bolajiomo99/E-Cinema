package licensing

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// Book is the executive Licensing page (Figma 117:1481): every partner, by country and plan.

type PartnerRow struct {
	Licence    string `json:"licence"`
	Name       string `json:"name"`
	Country    string `json:"country"`
	Plan       string `json:"plan"`
	Status     string `json:"status"`
	Sales30NGN int64  `json:"sales30Ngn"`
	Compliance int    `json:"compliance"`
}

type Book struct {
	Partners     int            `json:"partners"`
	Countries    int            `json:"countries"` // countries partners may sell in
	FeesYearNGN  int64          `json:"feesYearNgn"`
	FeesPrevNGN  int64          `json:"feesPrevNgn"` // the same stretch of last year
	RoyaltyNGN   int64          `json:"royaltyNgn"`  // this month
	SalesNGN     int64          `json:"salesNgn"`    // this month
	ByCountry    map[string]int `json:"byCountry"`
	Plans        map[string]int `json:"plans"`
	Rows         []PartnerRow   `json:"rows"`
	Applications int            `json:"applications"` // waiting for review
}

func (st Store) Book(ctx context.Context, now time.Time) (Book, error) {
	o := Book{ByCountry: map[string]int{}, Plans: map[string]int{}, Rows: []PartnerRow{}}
	lagos := time.FixedZone("WAT", 3600)
	l := now.In(lagos)
	year := time.Date(l.Year(), 1, 1, 0, 0, 0, 0, lagos)
	month := time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, lagos)
	if err := st.DB.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status = 'active')::int,
	    (SELECT count(DISTINCT c)::int FROM brand_licensees b, unnest(b.countries) c WHERE b.status = 'active'),
	    (SELECT count(*)::int FROM licence_applications WHERE status = 'submitted')
	  FROM brand_licensees`).Scan(&o.Partners, &o.Countries, &o.Applications); err != nil {
		return o, err
	}
	if err := st.DB.QueryRow(ctx, `SELECT
	    coalesce((SELECT sum(fee_ngn) FROM licence_applications WHERE paid_at >= $1), 0) + coalesce((SELECT sum(fee_ngn) FROM licence_renewals WHERE paid_at >= $1), 0),
	    coalesce((SELECT sum(fee_ngn) FROM licence_applications WHERE paid_at >= $2 AND paid_at < $3), 0) + coalesce((SELECT sum(fee_ngn) FROM licence_renewals WHERE paid_at >= $2 AND paid_at < $3), 0)`,
		year, year.AddDate(-1, 0, 0), now.AddDate(-1, 0, 0)).Scan(&o.FeesYearNGN, &o.FeesPrevNGN); err != nil {
		return o, err
	}
	rows, err := st.DB.Query(ctx, `SELECT b.licence, b.name, b.country, b.plan, b.status, b.countries, b.valid_from,
	    coalesce((SELECT sum(amount_ngn) FROM licence_sales s WHERE s.licence = b.licence AND NOT s.returned AND s.sold_at >= $1), 0)::bigint,
	    coalesce((SELECT sum(amount_ngn) FROM licence_sales s WHERE s.licence = b.licence AND NOT s.returned AND s.sold_at >= $2), 0)::bigint
	  FROM brand_licensees b ORDER BY b.status = 'active' DESC, b.name`, now.AddDate(0, 0, -30), month)
	if err != nil {
		return o, err
	}
	type raw struct {
		row       PartnerRow
		lic       Licensee
		monthSale int64
	}
	var all []raw
	for rows.Next() {
		var r raw
		if err := rows.Scan(&r.row.Licence, &r.row.Name, &r.row.Country, &r.row.Plan, &r.row.Status, &r.lic.Countries, &r.lic.ValidFrom, &r.row.Sales30NGN, &r.monthSale); err != nil {
			rows.Close()
			return o, err
		}
		r.lic.Licence = r.row.Licence
		all = append(all, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil && err != pgx.ErrNoRows {
		return o, err
	}
	for _, r := range all {
		c, err := st.Compliance(ctx, r.lic)
		if err != nil {
			return o, err
		}
		r.row.Compliance = c.Score
		if r.row.Status == "active" {
			o.ByCountry[r.row.Country]++
			o.Plans[r.row.Plan]++
			o.SalesNGN += r.monthSale
			o.RoyaltyNGN += r.monthSale * int64(Plans[r.row.Plan].RoyaltyPct) / 100
		}
		o.Rows = append(o.Rows, r.row)
	}
	return o, nil
}
