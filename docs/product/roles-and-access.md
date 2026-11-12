# Roles and access

| Role | How they get in | What they see and do | Device |
|------|-----------------|----------------------|--------|
| **Teacher** | Email and password | Everything within their own account: students, payments, schedule, library, lessons, homework, assessments, dashboards, reports | Mostly a computer, 1280 px and wider |
| **Student** | No registration: a permanent personal link with a secret token | Their current homework, their vocabulary, an active assessment. Nothing of anyone else | Mostly a phone |
| **Parent** | No sign-in: a separate permanent personal link, view only | Their child's dashboard and the reports sent to them | Phone and email |
| **Assistant agent** | A personal token of the teacher, through MCP | Reads student context and materials, saves drafts. Never publishes, never sees payments or contacts | Runs in the teacher's own session |

## Links

- A link carries a long, unguessable token, never a student identifier.
- The student link and the parent link are different and carry different rights. With a parent session the student page does not open, and the other way round.
- The teacher can copy a link from the student card at any time; copying never changes it.
- The teacher can reissue a link: the old one stops working at once, together with every session opened from it.
- Nothing can be changed through a parent link. A parent sees payments only if the teacher added them to a report.
- A revoked, a foreign and a random link look the same: "Ссылка больше не действует".

How links are issued and revoked by student status is decided in the skeleton slices #19–#21; see [Data flows and events](data-flows.md).

## Visibility rules

- A student sees only their own data, and only what is published. Past homework and reviewed mistakes are not shown to the student, only the current homework.
- A parent sees the dashboard and the reports that were sent.
- Notes, gaps, payments and contacts are for the teacher only.
- A student's last name, if the teacher entered one, is shown to the teacher only. It never appears on student or parent pages, in their responses or in logs (#18).
- Learning files (textbooks) are for the teacher only, with no public links. A student receives only what the teacher put into their published homework.

## Built in from the start, delivered later

- **Several teachers.** Every record belongs to a teacher; teachers never see each other's students.
- **Groups.** Students can be combined into groups with their own lessons, schedule and materials. The data model exists from the first migration; the interface is stage 3.
- **Schedule access for students and parents**, including booking (stage 3).
