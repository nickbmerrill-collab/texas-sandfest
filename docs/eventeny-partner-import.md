# Eventeny partner application import

The operations console can mirror Eventeny vendor and sponsor applications into the SandFest workflow without manual re-entry. This is a review-first bridge, not a replacement for Eventeny.

## Operator flow

1. Export current-season applications from Eventeny as CSV.
2. Open **Partner operations** in the staff console and choose **Import Eventeny applications**.
3. Select or paste the CSV. Choose a default vendor/sponsor type only when the export has no type column.
4. Confirm that the Eventeny applicant relationship permits transactional organizer messages.
5. Preview every row. Resolve invalid catalog matches and changed-record conflicts before committing.
6. Commit the preview. The CSV, current event, defaults, and active package/offering catalog must still match the preview hash.

`POST /api/admin/partners/import` requires `partners:write` and accepts `mode: "preview"` or `mode: "commit"`.

## Required data

The importer accepts common Eventeny aliases. Each row must supply:

- External ID: `external_id`, `application_id`, `submission_id`, `eventeny_id`, `reference`, or `id`
- Type: `type`, `application_type`, `applicant_type`, or `partner_type`, unless the operator chooses a default
- Organization: `organization_name`, `business_name`, `company_name`, `vendor_name`, `sponsor_name`, or `name`
- Contact name and valid contact email
- Sponsor package by active `package_id` or exact package name, or vendor offering by active `offering_id`/name plus a supported vendor category

Optional columns include phone, website, city/state/ZIP, source status, event ID, reported amount, description, and tags. Imports are capped at 500 rows and reject mixed annual-event data.

## Safety contract

- Catalog prices are authoritative. A CSV-reported amount is retained only as provider provenance and never becomes the expected fee.
- Provider status is retained as `sourceStatus`; the local record always enters as `submitted` for SandFest review.
- Every accepted row atomically creates the normal review task, key dates, and vendor-readiness or sponsor-fulfillment records.
- Eventeny imports do not create an `application_received` follow-up because the provider already handles intake acknowledgment.
- An exact external-ID replay is a duplicate and adds nothing. A changed row with the same external ID is a conflict for manual review.
- Commit audits contain only batch ID, file name, and aggregate counts. Raw CSV and applicant contacts are not written to audit records.
