# Clean fixture workstation (test data only)

Every compliance check passes here except check 7 (not a git repository: warn).

Its audit hall holds one strike for Paul (2026-10-01) and a pardon of Paul (2026-10-02,
`outcome: pardon`, `pardons: [paul]`), so the roster's 0 / 3 is correct and checks 5 and 6
pass: the pardon covers every strike dated on or before it.
