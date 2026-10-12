# Issue 9: assignment instructor attachments

The assignment detail tool previously exposed only submission and grading status. Moodle supplied instructor files in `introfiles` and `introattachments`, but no tool returned their handles.

`moodle_get_assignment` now includes validated inline instructions, due date, and deduplicated instructor attachment handles alongside existing status information. Tool names and input arguments remain stable. Deployment content restrictions still apply. Text and attachment collections are capped and omissions reported.

Instructor handles use a distinct sealed assignment reference. Reading a handle rechecks current course enrolment and the assignment's current attachment list, then applies the existing safe-host/protocol/pluginfile checks. Submission attachment authorization remains separate.

## Verification

- Build and diff whitespace checks passed.
- 464 unit tests across 49 files passed, including regressions for instructions, deduplication, URL hiding, disabled content access, unsafe destinations, caps, removed attachments, and revoked enrolment.
- Existing 50 real-provider/workerd security checks and 23 stdio/HTTP compatibility checks passed against fixture Moodle. These are not additional live assignment coverage.
- Live authenticated Moodle verification returned the actual Assignment 2 PDF and image; the PDF had two pages of extractable text and both files downloaded.
- A real SDK stdio client called assignment listing, assignment details, and PDF reading successfully against the student's Moodle account. No authenticated file URLs appeared in assignment details.

Private document contents, credentials, and file handles are deliberately excluded from this report. Production ChatGPT verification remains a separate check after deployment.
