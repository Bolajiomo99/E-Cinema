package accounts_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Bolajiomo99/E-Cinema/api/internal/accounts"
)

// Student Pro needs a verified student: a code to a school email, once per school email.
func TestStudentVerification(t *testing.T) {
	s, _ := store(t)
	ctx := context.Background()
	a, _, err := s.SignUp(ctx, "stu@example.com", "Ada Obi", pw, "x")
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := s.SignUp(ctx, "stu2@example.com", "Bola", pw, "x")
	if _, err := s.ChoosePlan(ctx, a.ID, "student"); !errors.Is(err, accounts.ErrNotStudent) {
		t.Fatalf("student plan before verifying: %v", err)
	}
	if _, err := s.StudentCode(ctx, a.ID, "University of Lagos", "ada@gmail.com"); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("personal email: %v", err)
	}
	if _, err := s.VerifyStudent(ctx, a.ID, "123456"); !errors.Is(err, accounts.ErrNoStudentCode) {
		t.Fatalf("verify before code: %v", err)
	}
	c, err := s.StudentCode(ctx, a.ID, "University of Lagos", "Ada@Live.Unilag.edu.ng")
	if err != nil || len(c.Code) != 6 || c.Email != "ada@live.unilag.edu.ng" {
		t.Fatalf("code = %+v, %v", c, err)
	}
	if _, err := s.VerifyStudent(ctx, a.ID, "000000"); !errors.Is(err, accounts.ErrBadCode) && c.Code != "000000" {
		t.Fatalf("wrong code: %v", err)
	}
	st, err := s.VerifyStudent(ctx, a.ID, c.Code)
	if err != nil || !st.Verified || st.Method != "email" || st.School != "University of Lagos" || st.Until.Before(time.Now().Add(360*24*time.Hour)) {
		t.Fatalf("verified = %+v, %v", st, err)
	}
	if p, err := s.ChoosePlan(ctx, a.ID, "student"); err != nil || p.PendingPlan != "student" {
		t.Fatalf("student plan after verifying: %+v %v", p, err)
	}
	if _, err := s.StudentCode(ctx, b.ID, "University of Lagos", "ada@live.unilag.edu.ng"); !errors.Is(err, accounts.ErrStudentTaken) {
		t.Fatalf("same school email on a second account: %v", err)
	}
	// A student ID read by the web server lasts until the card expires.
	exp := time.Now().Add(60 * 24 * time.Hour)
	st, err = s.StudentByID(ctx, b.ID, "Yaba College of Technology", exp)
	if err != nil || !st.Verified || st.Method != "id" || st.Until.After(exp.Add(time.Second)) {
		t.Fatalf("by id = %+v, %v", st, err)
	}
	if _, err := s.StudentByID(ctx, b.ID, "Yaba", time.Now().Add(-time.Hour)); !errors.Is(err, accounts.ErrBadInput) {
		t.Fatalf("expired card: %v", err)
	}
}
