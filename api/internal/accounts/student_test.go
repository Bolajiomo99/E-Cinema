package accounts

import "testing"

func TestSchoolEmail(t *testing.T) {
	for e, want := range map[string]bool{
		"ada@live.unilag.edu.ng": true, "ada@mit.edu": true, "ada@ox.ac.uk": true, "ada@student.uva.nl": true,
		"ada@gmail.com": false, "ada@ac.com": false, "ada@education.com": false, "ada@edu": false, "nope": false,
	} {
		if got := SchoolEmail(e); got != want {
			t.Errorf("SchoolEmail(%q) = %v", e, got)
		}
	}
}
