package accounts_test

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestPlanLifecycle(t *testing.T) {
	st, _ := store(t)
	ctx := context.Background()
	a, _, err := st.SignUp(ctx, fmt.Sprintf("plan%d@example.com", time.Now().UnixNano()), "Plan", pw, "x")
	if err != nil {
		t.Fatal(err)
	}

	p, err := st.ChoosePlan(ctx, a.ID, "pro")
	if err != nil || p.Plan != "pro" || p.PlanStatus != "awaiting_payment" || p.PendingPlan != "pro" {
		t.Fatalf("choose pro: %+v %v", p, err)
	}
	renews := time.Now().Add(30 * 24 * time.Hour)
	prev, err := st.ActivatePlan(ctx, a.ID, "pro", "I-ONE", renews)
	if err != nil || prev != "" {
		t.Fatalf("activate: %q %v", prev, err)
	}
	// The return page and the webhook both activate; the second call changes nothing.
	if prev, err = st.ActivatePlan(ctx, a.ID, "pro", "I-ONE", renews); err != nil || prev != "" {
		t.Fatalf("activate again: %q %v", prev, err)
	}
	// Picking another paid plan keeps Pro active until the new one is approved.
	p, _ = st.ChoosePlan(ctx, a.ID, "enterprise")
	if p.Plan != "pro" || p.PlanStatus != "active" || p.PendingPlan != "enterprise" || !p.Subscribed {
		t.Fatalf("switch pending: %+v", p)
	}
	if prev, _ = st.ActivatePlan(ctx, a.ID, "enterprise", "I-TWO", renews); prev != "I-ONE" {
		t.Fatalf("previous subscription = %q", prev)
	}
	// Cancelling the old subscription must not touch the new plan.
	_ = st.EndSubscription(ctx, "I-ONE")
	if p, _ = st.GetProfile(ctx, a.ID); p.Plan != "enterprise" {
		t.Fatalf("old cancel changed plan: %+v", p)
	}
	_ = st.EndSubscription(ctx, "I-TWO")
	if p, _ = st.GetProfile(ctx, a.ID); p.Plan != "free" || p.Subscribed {
		t.Fatalf("end: %+v", p)
	}
}
