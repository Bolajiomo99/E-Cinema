package studios

import (
	"context"
	"regexp"
	"slices"
	"strings"
)

// Studio settings switches (Figma 39:1184) that change how the studio's films are handled.

// SetDubReview is the "AI dub approval" switch in studio settings (owners and admins).
func (st Store) SetDubReview(ctx context.Context, acct, email string, on bool) (Studio, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return s, err
	}
	if _, err := st.DB.Exec(ctx, `UPDATE studios SET dub_review = $2 WHERE name = $1`, s.Name, on); err != nil {
		return s, err
	}
	s.DubReview = on
	return s, nil
}

var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

// SetTerritories is "Default territories" in studio settings: the countries where none of the
// studio's films are sold. An empty list is worldwide.
func (st Store) SetTerritories(ctx context.Context, acct, email string, blocked []string) (Studio, error) {
	s, err := st.verified(ctx, acct, email, true)
	if err != nil {
		return s, err
	}
	out := []string{}
	for _, c := range blocked {
		c = strings.ToUpper(strings.TrimSpace(c))
		if !countryCode.MatchString(c) || len(out) >= 250 {
			return s, ErrBadInput
		}
		if !slices.Contains(out, c) {
			out = append(out, c)
		}
	}
	slices.Sort(out)
	if _, err := st.DB.Exec(ctx, `UPDATE studios SET blocked_countries = $2 WHERE name = $1`, s.Name, out); err != nil {
		return s, err
	}
	s.Blocked = out
	return s, nil
}
