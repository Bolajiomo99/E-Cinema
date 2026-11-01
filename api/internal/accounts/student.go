package accounts

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Student offer (Figma 94:1327): Student Pro is for verified students, checked once a year.
const StudentFor = 365 * 24 * time.Hour

var (
	ErrNotStudent     = errors.New("Student Pro needs a verified student; verify with your school email or student ID first")
	ErrNotSchoolEmail = fmt.Errorf("%w: use the email your school or university gave you (for example one ending in .edu or .ac.uk)", ErrBadInput)
	ErrStudentTaken   = errors.New("that school email already verifies another account")
	ErrNoStudentCode  = errors.New("ask for a code first")
)

type StudentStatus struct {
	Verified bool       `json:"verified"`
	School   string     `json:"school,omitempty"`
	Email    string     `json:"email,omitempty"` // masked
	Method   string     `json:"method,omitempty"`
	Until    *time.Time `json:"until,omitempty"`
	Pending  string     `json:"pending,omitempty"` // masked address a code went to
}

// SchoolEmail reports whether an address looks like one a school hands out: an "edu" or "ac"
// label (mit.edu, ox.ac.uk, live.unilag.edu.ng) or a student sub-domain (student.uva.nl).
func SchoolEmail(e string) bool {
	at := strings.LastIndexByte(e, '@')
	if at < 1 {
		return false
	}
	labels := strings.Split(strings.ToLower(e[at+1:]), ".")
	if len(labels) < 2 {
		return false
	}
	for i, l := range labels[:len(labels)-1] {
		if l == "edu" || (l == "ac" && i > 0) || (i == 0 && (l == "student" || l == "students" || l == "stud" || l == "stu")) {
			return true
		}
	}
	return labels[len(labels)-1] == "edu"
}

func (s Store) Student(ctx context.Context, accountID string) (StudentStatus, error) {
	var st StudentStatus
	var school, email, pending, method *string
	err := s.DB.QueryRow(ctx, `SELECT student_school, student_email, student_pending_email, student_method, student_verified_until FROM accounts WHERE id = $1`,
		accountID).Scan(&school, &email, &pending, &method, &st.Until)
	if err != nil {
		return st, err
	}
	if school != nil {
		st.School = *school
	}
	if email != nil {
		st.Email = MaskEmail(*email)
	}
	if pending != nil {
		st.Pending = MaskEmail(*pending)
	}
	if method != nil {
		st.Method = *method
	}
	st.Verified = st.Until != nil && st.Until.After(time.Now())
	return st, nil
}

// StudentCode sends a six-digit code to the school email. The caller emails it.
func (s Store) StudentCode(ctx context.Context, accountID, school, email string) (CodeIssued, error) {
	school = strings.TrimSpace(school)
	if school == "" || len(school) > 120 {
		return CodeIssued{}, fmt.Errorf("%w: add your school or university", ErrBadInput)
	}
	e, ok := normEmail(email)
	if !ok || !SchoolEmail(e) {
		return CodeIssued{}, ErrNotSchoolEmail
	}
	var taken bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM accounts WHERE student_email = $1 AND id <> $2)`, e, accountID).Scan(&taken); err != nil {
		return CodeIssued{}, err
	}
	if taken {
		return CodeIssued{}, ErrStudentTaken
	}
	var name string
	if err := s.DB.QueryRow(ctx, `UPDATE accounts SET student_school = $2, student_pending_email = $3 WHERE id = $1 RETURNING name`, accountID, school, e).Scan(&name); err != nil {
		return CodeIssued{}, err
	}
	return s.issue(ctx, accountID, e, name, "", "student")
}

// VerifyStudent checks the code and marks the account a student for a year.
func (s Store) VerifyStudent(ctx context.Context, accountID, code string) (StudentStatus, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return StudentStatus{}, err
	}
	defer tx.Rollback(ctx)
	var pending *string
	if err := tx.QueryRow(ctx, `SELECT student_pending_email FROM accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&pending); err != nil {
		return StudentStatus{}, err
	}
	if pending == nil {
		return StudentStatus{}, ErrNoStudentCode
	}
	if err := s.checkCode(ctx, tx, accountID, "student", code); err != nil {
		if errors.Is(err, ErrBadCode) || errors.Is(err, ErrPaused) || errors.Is(err, ErrCodeExpired) {
			_ = tx.Commit(ctx) // keep the spent try
		}
		return StudentStatus{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE accounts SET student_email = student_pending_email, student_pending_email = NULL,
	  student_method = 'email', student_verified_until = now() + $2::interval WHERE id = $1`, accountID, StudentFor.String())
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return StudentStatus{}, ErrStudentTaken
	}
	if err != nil {
		return StudentStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StudentStatus{}, err
	}
	return s.Student(ctx, accountID)
}

// StudentByID records a student ID the web server has checked (photo read by AI, name matched).
// It lasts until the card's expiry date, and at most a year.
func (s Store) StudentByID(ctx context.Context, accountID, school string, expires time.Time) (StudentStatus, error) {
	school = strings.TrimSpace(school)
	if school == "" || len(school) > 120 {
		return StudentStatus{}, fmt.Errorf("%w: the card shows no school", ErrBadInput)
	}
	until := time.Now().Add(StudentFor)
	if !expires.IsZero() && expires.Before(until) {
		until = expires
	}
	if !until.After(time.Now()) {
		return StudentStatus{}, fmt.Errorf("%w: that student ID has expired", ErrBadInput)
	}
	if _, err := s.DB.Exec(ctx, `UPDATE accounts SET student_school = $2, student_method = 'id', student_verified_until = $3 WHERE id = $1`, accountID, school, until); err != nil {
		return StudentStatus{}, err
	}
	return s.Student(ctx, accountID)
}

func (s Store) isStudent(ctx context.Context, accountID string) (bool, error) {
	var ok bool
	err := s.DB.QueryRow(ctx, `SELECT coalesce(student_verified_until > now(), false) FROM accounts WHERE id = $1`, accountID).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return ok, err
}
