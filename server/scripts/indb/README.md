# INDB → catalogue enrichment

Grows `database/seed/recipes.json` with dishes from the **Indian Nutrient Databank
(INDB)**, keeping INDB's authoritative per-serving nutrition and using Claude Haiku
(via the Message Batches API) to backfill the descriptive fields INDB lacks.

**Principle:** INDB = nutrition truth; Haiku only fills ingredients/method/flags and
acts as a suitability gate. Nutrition is never produced by the model — `merge.py`
re-applies the INDB values, so macros can't be hallucinated into the catalogue.

## Prerequisites

```
pip install anthropic openpyxl
export ANTHROPIC_API_KEY=...        # Stage B only; needs Batches access
```

## Run order

```
# Stage A — deterministic, no AI. Downloads the workbook, QA-filters, writes candidates.
python scripts/indb/extract.py
#   -> database/seed/indb/indb_candidates.json   (~366 dishes, nutrition locked)

# Stage B — Haiku enrichment via the Batches API (50% cheaper, async, resumable).
python scripts/indb/enrich.py --smoke 12     # tiny preview batch -> _smoke.json (review first!)
python scripts/indb/enrich.py                # full run: chunk_NN.json, skips finished chunks

# Stage C — validate, re-apply INDB nutrition, dedup, append.
python scripts/indb/merge.py --dry-run       # counts only
python scripts/indb/merge.py                 # appends accepted dishes to recipes.json

# Load into the DB with the existing idempotent scripts:
php scripts/seed.php
php scripts/backfill-images.php
```

`merge.py --source smoke` validates/merges the smoke output instead of the chunks
(useful to exercise Stage C end-to-end on the preview before the full run).

## Working data

Everything under `database/seed/indb/` (the workbook + intermediate JSON) is
git-ignored. Only the final accepted dishes land in `recipes.json`.

## Attribution

INDB is open-access. Cite when shipping its data:

> Vijayakumar A, Dubasi HB, Awasthi A, Jaacks LM. Development of an Indian Food
> Composition Database. *Current Developments in Nutrition*. 2024.

Source: https://www.anuvaad.org.in/indian-nutrient-databank/
