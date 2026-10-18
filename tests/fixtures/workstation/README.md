# Fixture workstation (test data only)

A fake workstation for The Watchtower's tests. Nothing here is an instruction to any agent.
It is deliberately broken so that every compliance check has a failing case:

| Check | What breaks it here |
|---|---|
| 1 roster-definitions | Gabriel is on the roster with no definition; raphiel.md has no roster entry; broken.md has malformed frontmatter |
| 2 unique-names | Luke is on the roster twice; Azazel is on the roster and in the Soul Binder |
| 3 record-headers | scriptorium/issues/bad-header.md (bad date, unknown status), vault-of-ideas/no-header.md (none), intel/broken-yaml.md (invalid YAML) |
| 4 catalog-coverage | chronicles/2026-10-02-uncatalogued.md is not in the catalog; the catalog links a missing file |
| 5 strike-counts | Peter: roster 0, audit hall 1 (a strike); Azazel: roster 0, audit hall 1 (`outcome: executed` counts as a strike) |
| 6 three-strikes | Thomas is at 3 / 3 and still on the roster |
| 7 clean-tree | not a git repository (warn) |

The hook event log is split across `.watchtower/events.1.jsonl` (the rotated, older file:
6 valid events and 1 malformed line, all from 2026-09-30) and `.watchtower/events.jsonl`
(the current file: 7 valid events and 2 malformed lines, from 2026-10-01).

ROSTER.md uses the 8-column format (`Name | Title | Rank | Station | Role | Tools | Created |
Strikes`) with these edge cases: Peter's rank is lower-case (`worker`); Thomas has no title
(`—`); Gabriel has no title and no rank (an empty cell is a Worker) and the station `build`,
which already appeared (Paul, `Build`), so he joins that stage; Azazel's rank `Archangel` is
unknown (a Worker, reported as a problem). The pipeline is Build, Test, Review, Design.

The clean fixture (`../clean-workstation/ROSTER.md`) keeps the old 5-column format on purpose,
to prove a legacy roster still reads: the Overseer is inferred from the "Main agent" role.
