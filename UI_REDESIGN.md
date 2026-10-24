# Pandav UI Redesign Brief

Everything the app does today, screen by screen and component by component, so every screen can be
redesigned without losing a feature. Audited on branch `v1` at commit `0e8c5d4` (Phase 8),
2026-10-20.

**How to read it**

| Section | What it gives you |
|---|---|
| [1. Product](#1-product) | What Pandav is, the four roles, the rules that change what a screen shows |
| [2. Features](#2-features) | Everything built, by module, including what the API can do that no screen shows yet |
| [3. Screen map](#3-screen-map) | Every route and today's navigation per role |
| [4. Screens](#4-screens) | Each screen: contents top to bottom, actions, form fields, states, what to fix |
| [5. Components](#5-components) | The component kit the redesign needs, and where each is duplicated today |
| [6. Status vocabulary](#6-status-vocabulary) | Every status, badge and state that needs a design |
| [7. Visual system today](#7-visual-system-today) | Tokens, fonts, colours, icons and motion as they actually are |
| [8. Cross-cutting problems](#8-cross-cutting-problems) | Problems that span screens |
| [9. Bugs found](#9-bugs-found) | Functional bugs to fix during the redesign |
| [10. Constraints](#10-constraints) | API, field limits, rate limits and test selectors to respect |
| [11. Suggested direction](#11-suggested-direction) | Proposed navigation, merges, order of work, and decisions for the owner |

**API only** marks something the backend already supports that no screen offers. The redesign can
add it without backend work. **No API** marks a gap that needs backend work first.

---

## 1. Product

Pandav is a web app for running a team's day-to-day work:
- tasks, with completion approval
- daily attendance, with approval
- teams
- direct and team chat
- a **Social Hub**: an internal feed, personal to-dos, connections, and publishing to LinkedIn and GitHub

It also has a public marketing site.

**Stack**
- **Frontend** (`Frontend/`): React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7, `lucide-react` 0.577 (icons), `motion` 12 (animation), `socket.io-client`, Playwright (browser tests).
- **Backend** (`Backend/`): Node, Express, MongoDB, Socket.IO.
- **API**: under `/api/v2`, documented in [Backend/Doc/](Backend/Doc/).

### 1.1 Roles

| Role | How someone gets it | Home screen | What they can do |
|---|---|---|---|
| `user` | Default on sign-up. Also what someone returns to when removed from a team | `/user` | Own tasks, attendance, chat, Social Hub. Can start a team or accept an invite |
| `team_member` | Accepting a team invite | `/team-member` | Same as user, inside one team |
| `team_leader` | Creating a team, or being made a leader by an admin | `/teams` | Same as member, plus: create, edit and delete the team's tasks; approve the team's tasks and attendance; invite and remove people; approve members' LinkedIn and GitHub posts |
| `admin` | Set by another admin (only between `user` and `admin`, only for someone not in a team) | `/admin` | Everything: all users, teams, tasks, attendance, the contact inbox and moderation |

### 1.2 Rules that change what a screen shows

- **One team per person.** Admins are never in a team.
- **Frozen team.** An admin can freeze a team. Everyone can still read it, but nobody can add or change anything, its chat is read-only, and its waiting approvals go to admins. Members still work their own tasks and check in.
- **Who can message whom.** Admins can message anyone. Everyone else can message teammates (unless the team is frozen), Social Hub connections, and anyone who messaged them first. The limit is 45 messages a minute.
- **Who reviews a task.** An admin, or a leader of a non-frozen team that contains every assignee, as long as the leader is not an assignee. The same people can edit and delete the task.
- **External posts need approval.** When a `user` or `team_member` targets LinkedIn or GitHub, the post waits for approval from their leader or an admin.
- **One attendance record per person per day.** The day is taken in Asia/Kolkata time (`APP_TIMEZONE`).

---

## 2. Features

### 2.1 Accounts and sessions
- **Sign up:** name, email, password, and optionally phone, department and photo. The new account is always a `user`, and isn't signed in automatically.
- **Sign in:** with "Remember me". The session is an HttpOnly cookie. Ten failed attempts in 15 minutes lock sign-in.
- **Session check on page load:** it can wait up to 90 seconds while a sleeping server wakes up.
- **Sign out:** signs out this browser only.
- **Profile:** edit name, email and phone. Upload a photo; the browser resizes it to 256px JPEG, and it must be 200 KB or less.
- **Admin password reset:** an admin sets a new password for someone, which signs them out everywhere.
- **Admin activate or deactivate:** an admin can switch an account on or off.
- **API only:**
  - change your own password
  - edit department
  - remove your profile photo
  - admin: delete a user
  - admin: change a role between user and admin
  - admin: edit a user's details
  - filter users by role, department or active state
- **No API:** a self-service "forgot password". The login screen tells people to ask an admin.

### 2.2 Tasks
- **Create, edit and delete** (admins, and leaders for their team): title, description, start date, due date, priority, one or more assignees, tags and notes.
- **Per-assignee progress.** Each assignee starts their part and then requests completion. The task becomes "completion requested" once everyone has.
- **Review.**
  - Approve, which marks the task completed.
  - Or reject with a reason, which sends it back to in progress. The card then shows the reason, who rejected it and when.
  - Admins review on `/tasks` and `/admin`; leaders review on `/teams`.
- **Edit history.** A task shows "Edited by {name} · {date and time}".
- **Finding tasks:** search (title, description, tags), a status filter, paging in the browser, and an automatic refresh every 30 seconds.
- **Counts:** overdue, due within 3 days, and urgent.
- **Leaderboard:** the top 20 people by completed tasks, all-time, across the whole company.
- **API only:**
  - cancel a task, or override its status (admin)
  - filter by priority or assignee
  - server-side paging
  - review as soon as *one* assignee has asked
  - a single-task endpoint for a detail view

### 2.3 Attendance
- **Check in and check out** once a day. Work hours are calculated automatically.
- **Approval.** Every check-in waits for approval: pending, then approved or rejected.
- **Day types:** present, absent, late, half-day, leave.
- **Admin:**
  - On `/attendance`: add a record for anyone, delete records.
  - On `/admin/attendance`: edit status, approval and remarks; approve; reject with a reason; see a summary per person; filter by person, status, approval and date range.
- **Leader:** see the team's attendance, and approve or reject what is waiting.
- **Everyone:** a history table with a status filter, and this month's hours.
- **API only:**
  - employees request leave, a half-day or an absence for a day (creates a pending record)
  - the owner edits remarks while a record is pending
  - admins edit dates and check-in/out times
  - server-side filters and paging

### 2.4 Teams
- **Create a team.** Anyone not in a team can create one and becomes its leader. Admins create teams with a chosen leader.
- **Invites.** Leaders invite by typing a name or user id; admins pick from a list. An invite lasts 7 days and can be accepted or declined.
- **Membership.** Admins can add a leader. Leaders and admins can remove members or leaders.
- **Team details.** Renaming a team or changing its description is possible only from Chat's "Manage group" today. Only admins can delete a team, or freeze and unfreeze it.
- **Team work.** Leaders review the team's tasks and attendance.
- **API only:**
  - rename a team from the admin page (the API supports it)
  - a single-team endpoint
- **No API:**
  - see or withdraw the invites a team has sent
  - leave a team (an admin has to remove the person)

### 2.5 Chat
- **Direct messages** with the people you're allowed to message:
  - online dots and a typing indicator
  - read receipts ("Sent" / "Read")
  - unread counts per person
  - "load earlier" (50 per page)
  - a "Message info" panel
- **Team room** for each team:
  - sender names on messages
  - "Seen by N" with the readers' names
  - read-only while the team is frozen
- **Real time** through Socket.IO.
- **API only:** a list of every team chat with its last message. It would give admins access to team rooms and give everyone previews.
- **Missing:**
  - an unread badge anywhere outside `/chat`
  - notifications
  - last-message previews
  - unread counts for team chat

### 2.6 Social Hub
- **Feed:** visibility is public, team or connections. Likes, comments, and "load older".
- **Posts:** title, content, tags, visibility, and targets: the Pandav feed, LinkedIn and/or GitHub.
- **Approval:** a leader or an admin approves members' external posts.
- **Publishing to LinkedIn, or to GitHub as an issue,** through *publish jobs*: queue, process, retry. Admins also have "process due jobs".
- **Integrations:** link LinkedIn or GitHub by pasting an access token, then preview the profile and recent items.
- **Connections:** find people, send a request, accept or decline incoming ones.
- **Personal to-dos** ("Personal sprint"): title, description, priority, due date, and an "offer to share when done" flag. Complete, reopen, delete.
- **Auto-share:** completing a flagged to-do opens "Share this task?" with an editable post and an optional LinkedIn copy.
- **Admin moderation:** flag, hide, remove and restore posts.
- **API only:**
  - "Connect with LinkedIn/GitHub" (OAuth; the backend has it)
  - "My posts"
  - publish directly
  - edit a to-do, or mark it in progress
  - share any completed to-do
  - create a post from a task
  - links (media URLs) on posts
  - job and moderation filters
  - a moderation reason, unflag and unhide
  - Social Hub direct messages (stored with chat messages)
- **No API:**
  - unlink an account
  - edit or delete a post
  - withdraw a connection request
  - list posts waiting for approval

### 2.7 Admin
- **Admin dashboard:**
  - headline figures and quick actions
  - overdue tasks, completion requests, today's check-ins, people, attendance requests
  - tabs for tasks, attendance, users (activate, reset password) and flagged posts
- **User view:** a read-only look at one person's tasks and attendance.
- **Contact inbox:** status (new, in progress, resolved, closed), reply by email, delete.
- **Team management:** see [4.21](#421-team-management-adminteams).
- **No API:** an audit log. Social Hub actions are recorded, but nothing can read the records yet.

### 2.8 Public site
- Landing, About, Services, Pricing (three tiers, with no billing behind them), Contact (form and office hours), Login, Register, 404.

### 2.9 Platform (invisible, but shapes the UI)
- **Same-origin API.** The browser only talks to the frontend's own `/api` path, which forwards to the backend.
- **Expired sessions.** Any 401 does a hard reload to `/login`, with no "session expired" message.
- **Rate limits** answer 429 and need friendly messages (see [10.3](#103-rate-limits-the-ui-should-explain)).
- **Pages load on first visit**, so landing-page visitors don't download the app.
- **Browser tests** cover sign-in, admin, chat and teams ([Frontend/e2e/](Frontend/e2e/)).

---

## 3. Screen map

### 3.1 Routes

| Route | Screen | Who | Code |
|---|---|---|---|
| `/` | Landing | Everyone | [Landing.tsx](Frontend/src/pages/Landing.tsx) |
| `/about` | About | Everyone | [About.tsx](Frontend/src/pages/About.tsx) |
| `/service` | Services (nav label "Solutions") | Everyone | [Service.tsx](Frontend/src/pages/Service.tsx) |
| `/pricing` | Pricing | Everyone | [Pricing.tsx](Frontend/src/pages/Pricing.tsx) |
| `/contact` | Contact | Everyone | [Contactus.tsx](Frontend/src/components/Contactus.tsx) |
| `/login` | Login | Everyone | [Login.tsx](Frontend/src/pages/Login.tsx) |
| `/register` | Register | Everyone | [Register.tsx](Frontend/src/pages/Register.tsx) |
| `/dashboard` | Redirects to the role's home | Signed in | [DashboardRedirect.tsx](Frontend/src/pages/DashboardRedirect.tsx) |
| `/user` | User dashboard | Signed in (admins redirected) | [UserDashboard.tsx](Frontend/src/pages/UserDashboard.tsx) |
| `/tasks` | Tasks | Signed in | [Tasks.tsx](Frontend/src/pages/Tasks.tsx) |
| `/attendance` | Attendance | Signed in | [Attendance.tsx](Frontend/src/components/Attendance.tsx) |
| `/chat` | Chat | Signed in | [ChatPage.tsx](Frontend/src/pages/ChatPage.tsx), [Chat.tsx](Frontend/src/components/Chat.tsx) |
| `/profile` | Profile | Signed in | [Profile.tsx](Frontend/src/pages/Profile.tsx) |
| `/teams`, `/team` | Team dashboard (leader), or "Create your team" | Signed in (members redirected) | [TeamDashboard.tsx](Frontend/src/pages/TeamDashboard.tsx) |
| `/team-member` | Team member dashboard | Signed in (leaders and admins redirected) | [TeamMemberDashboard.tsx](Frontend/src/pages/TeamMemberDashboard.tsx) |
| `/social` | Social Hub | Signed in | [SocialHub.tsx](Frontend/src/pages/SocialHub.tsx) |
| `/todo`, `/network`, `/integrations`, `/publish-jobs` | The same Social Hub page; nothing links to these | Signed in | same |
| `/admin` | Admin dashboard | Admin | [AdminDashboard.tsx](Frontend/src/pages/AdminDashboard.tsx) |
| `/admin/attendance` | Attendance management | Admin | [Attendance-Admin.tsx](Frontend/src/pages/Attendance-Admin.tsx) |
| `/admin/users`, `/admin/userview` | User view (read-only) | Admin | [Userview.tsx](Frontend/src/pages/Userview.tsx) |
| `/admin/messages` | Contact messages | Admin | [ContactMessages.tsx](Frontend/src/pages/ContactMessages.tsx) |
| `/admin/teams` | Team management | Admin | [TeamManagement.tsx](Frontend/src/pages/TeamManagement.tsx) |
| `/admin/moderation` | The same Social Hub page | Admin | same |
| `*` | 404 | Everyone | [NotFound.tsx](Frontend/src/pages/NotFound.tsx) |

### 3.2 Navigation today

The sidebar shows text labels only: no icons, badges or counters. Profile is not in the sidebar; it
is reached from the top bar and the avatar menu.

| Role | Sidebar items, in order |
|---|---|
| admin | Dashboard (→ `/admin`) · Social Hub · Teams (`/admin/teams`) · Users (`/admin/users`, the read-only User view) · Attendance (`/admin/attendance`) · Messages · Tasks · Chat |
| team_leader | Dashboard (→ `/teams`) · Team (`/teams`, the same page) · Social Hub · Tasks · Attendance · Chat |
| team_member | Dashboard (→ `/team-member`) · Social Hub · My Tasks · My Attendance · Chat. There is no team link |
| user | Dashboard (→ `/user`) · Team (`/teams`) · Social Hub · Tasks · Attendance · Chat |

---

## 4. Screens

Each screen lists what it must keep (contents, actions, fields, states) and then what the redesign
should fix. Copy in quotes is today's wording.

### 4.0 App shell (every screen)

**Public header** (signed out, on public routes):
- Logo "Pandav".
- Links: Features (`/`), Solutions (`/service`), Pricing, About, Contact.
- "Login", and the "Get Started" button (→ `/register`).
- No mobile menu: on phones only the logo, Login and Get Started show.

**Footer:** only on Landing and Pricing.
- Brand line: "© 2024 Pandav Technologies…".
- Columns: Product, Support, Legal, Social.
- Seven of its links go nowhere (`#`).

**Signed-in shell** ([Navbar.tsx](Frontend/src/components/Navbar.tsx)):
- **Left rail** (256px, at 1024px and wider): logo (links to the marketing page) and the role's links.
- **Mobile drawer** (below 1024px): opened by a hamburger, has a "Close" text button.
- **Floating top bar:**
  - hamburger
  - breadcrumbs built from the URL (`/social` shows "Social", while the nav says "Social Hub")
  - "Refresh", which reloads the whole page
  - "Profile"
  - avatar menu: name, email, "View Profile", "Logout"

**Global feedback** ([FeedbackContext.tsx](Frontend/src/context/FeedbackContext.tsx)):
- **Toasts** at the bottom right (bottom centre on phones). Three tones: success (green, 4 s), error (red, 7 s), info (white, 4 s). Each has a "×" to dismiss.
- **Confirm and prompt dialogs** built on the native `<dialog>`: title, message, Cancel and a confirm button (green, or red when the action is dangerous). The prompt adds one labelled input.
- **Loading:** a green spinner while a page loads or the session is checked. It has no text, even when the server is slow to wake (up to 90 s).

**Fix in the redesign**
- Navigation:
  - Add icons, and badges for unread chat, waiting approvals, invites and new contact messages.
  - Highlight "Dashboard" when the user is on their home page. Today it is never highlighted, because `/dashboard` redirects.
  - Make breadcrumbs match the nav labels, or drop them.
  - Remove "Refresh" and the duplicate "Profile" button.
  - Send the logo to the role's home when signed in.
- Accessibility: make the drawer and the avatar menu accessible (Escape key, focus handling, menu semantics). Today the closed drawer's links can still be reached with the Tab key.
- Public site: add a mobile menu. Show the footer on every public page.
- Signed-in users on public pages: today the shell is drawn *over* the marketing page. Either hide the shell or redirect signed-in users away from `/login` and `/register`.
- Sessions: tell people when their session has expired. Show text on the slow-wake spinner.

### 4.1 Landing (`/`)

**Contents**
1. **Hero:**
   - pill "UNIFIED OPERATIONS"
   - H1 "The Digital **Atrium** for Modern Teams"
   - text "Break the spreadsheet trap…"
   - buttons "Get Started for Free" (→ `/register`) and "Request a Demo" (→ `/contact`)
   - a photo card with a floating panel showing invented figures: "LIVE PRODUCTIVITY 98.4%", "CHECK-INS 1,240"
2. **"Core Operating Pillars":** four cards: Task Lifecycle Management, Attendance & Check-ins, Team Operations, Internal Messaging. They include sample stage pills, a sample check-in chip and sample chat bubbles.
3. **"Who is Pandav for?":** Standard Users, Team Leaders, Admins.
4. **CTA:** "Ready to enter the Atrium?", with "Request a Demo".
5. **Footer.**

**Fix**
- Claims the product can't back up:
  - "location intelligence"
  - "automated follow-ups"
  - "Roster & shift planning"
  - "Organization-wide logs"
  - "24/7 Premium Support"
  - "Join over 500+ teams"
  - the invented metrics
- Missing: the Social Hub isn't mentioned, and team members are missing from the personas.
- Cards lift on hover but can't be clicked.
- The page has two `<main>` landmarks.
- The hero photo is hot-linked from Unsplash with no fallback.
- The 60px heading is too large on phones.

### 4.2 About (`/about`)

**Contents**
1. Hero: pill "Powering teams since 2024", H1 "About Pandav".
2. "Our Story": Mission and Vision cards, with emoji used as icons.
3. "What We Offer": Task Management, Attendance Tracking, Team Collaboration.
4. "Our Core Values": Efficiency, Reliability, Simplicity, Innovation. The first card is styled differently from the other three.
5. "Trusted Worldwide": "500+" Active Users, "10K+" Tasks Completed, "99.9%" Uptime.
6. CTA: "Get Started Now" (→ `/login`; it should go to `/register`) and "Contact Us".

**Fix**
- The figures are invented.
- "leave management" is claimed but has no screen.
- The page has no footer.
- The content starts underneath the fixed header.

### 4.3 Services (`/service`)

**Contents**
1. Hero: "Our Services".
2. "Core Features": six cards (Task Management, Attendance Tracking, User Management, Admin Dashboard, Contact Management, Security), each with three bullets.
3. "Why Choose Pandav": three cards.
4. "Built With Modern Technology": MERN, TypeScript, TailwindCSS, JWT Auth.
5. "Trusted By Teams Worldwide": 500+, 10K+, 99.9%, 24/7.
6. "Everything You Need": two lists, For Team Members and For Administrators.
7. CTA: "Get Started" (→ `/login`; it should go to `/register`).

**Fix**
- Missing content: Teams, Chat and the Social Hub (the main features), and the team leader role.
- Out of date: it says "Admin and user roles", but there are four roles.
- The tech-stack section is aimed at developers, not buyers.
- It contradicts other pages: "thousands" of organisations here, "hundreds" on About, "500+" on Landing; and "24/7" support against the Contact page's office hours.

### 4.4 Pricing (`/pricing`)

**Contents**
1. Header: "Simple plans for every stage".
2. Three plans:

| Plan | Price | Features | Button |
|---|---|---|---|
| Starter | $0 /month | Up to 10 members · Task board · Attendance check-in/out · Basic chat | "Start Free" |
| Growth ("Most Popular") | $29 /month | Up to 75 members · Task approval workflows · Attendance approvals · Team management · Priority support | "Choose Growth" |
| Enterprise | Custom | Unlimited members · Advanced admin controls · SLA and onboarding support · Integration consultation · Dedicated success manager | "Contact Sales" |

3. FAQ: four static questions about changing plans, support, annual billing and custom setup.
4. CTA band: "Create Account" and "Talk to Sales".
5. Footer.

**Fix**
- **The three plan buttons do nothing.**
- **"Most Popular", "Choose Growth" and "Create Account" are invisible** (see [9](#9-bugs-found)).
- It never says whether $29 is per team or per seat.
- Annual billing is promised, but there is no switch for it.
- The footer sits inside the page padding.

### 4.5 Contact (`/contact`)

**Contents**
1. Header: "Contact Us", "Have questions? We'd love to hear from you."
2. Form card, "Send us a Message" with "Open 24/7…":

| Field | Type | Required |
|---|---|---|
| Your Name | text | yes |
| Email Address | email | yes |
| Message | textarea | yes |

   Submit is "Send Message", which shows "Sending..." while it works.
3. "Get in Touch" card, with email, phone and WhatsApp links. It shows only when `VITE_CONTACT_*` is set, so production hides it.
4. "Call Us: Office Hours": Mon–Fri 9:00 AM – 6:00 PM, Sat 10:00 AM – 4:00 PM, Sun Closed. These are sample hours still to be confirmed, and no timezone is given.

**Fix**
- **The form can never be sent.** It requires a subject, but there is no subject field, so every submit fails with "Please fill in all required fields." The server needs `subject` too, so add Subject (required) and Phone (optional) fields.
- The success text has a typo: "Well get back to you soon."
- Inputs have no visible focus.
- There are no per-field errors.

### 4.6 Login (`/login`)

**Contents:** a single card, "Welcome back" / "Sign in to your account".

| Field | Type | Notes |
|---|---|---|
| Email | email | required |
| Password | password | required, with a "Show/Hide" toggle |
| Remember me | checkbox | keeps the session longer |

- "Forgot password?" shows the help text "Ask your admin to reset it…".
- Button "Sign in".
- Link "Don't have an account? Sign up".
- A green notice appears after registering: "Registration successful! Please login."

**Errors:**
- "Invalid credentials"
- "Account is deactivated. Please contact admin."
- "Too many failed login attempts. Please try again in 15 minutes."
- "Cannot connect to server…"

**After sign-in:** the page the person came from, otherwise the role's home.

**Fix**
- There is no brand or logo on the card.
- Signed-in users aren't redirected away from this page.
- No `autocomplete` attributes.
- No visible focus on inputs.
- The button is black here and green on Register.

### 4.7 Register (`/register`)

**Contents:** "Create an account" / "Sign up to get started".

| Field | Type | Required | Rules |
|---|---|---|---|
| Profile Picture | photo picker (camera badge on a round preview) | no | image only, 5 MB or less before resizing; "Remove image" link |
| Full Name | text | yes | |
| Email | email | yes | must look like an email |
| Phone Number | tel | no | |
| Department | select | no | 14 fixed options, mixing job titles and departments (Frontend Developer … Customer Support) |
| Password | password, Show/Hide | yes | at least 6 characters |
| Confirm Password | password, Show/Hide | yes | must match |

- Button "Create account".
- Link "Already have an account? Sign in".
- On success, the person goes to Login (no automatic sign-in).
- Errors: "User already exists", "Too many accounts created from this network…", and the image-size message.

**Fix**
- The photo picker can't be reached with the keyboard.
- No terms or privacy consent (and those footer links are dead).
- No password strength hint.
- No `autocomplete` attributes.
- The tall card starts under the fixed header.

### 4.8 404 (`*`)

**Contents:** "404", "Page not found", "The page you're looking for doesn't exist or has moved." One button: "Back to home" when signed out, "Back to dashboard" when signed in.

**Fix**
- The dashboard button sends leaders and members to `/user` instead of their own home.
- Signed-out visitors get no navigation at all.

### 4.9 User dashboard (`/user`)

**Who:** home for `user`. Leaders and members can open it by URL. Admins are redirected.

**Contents**
1. **Welcome banner:** "Good morning/afternoon/evening, {first name}!", with chips for Active Tasks and Completion Rate.
2. **No-team card** (role `user` only): "You're not in a team yet", with "Start or join a team" (→ `/teams`).
3. **Stat cards:** Total Tasks, Pending, In Progress, Completed.
4. **Alerts:** "Overdue Tasks (N)" and "Due Soon (N)" (due within 3 days). Each shows the first three, then "+N more".
5. **Social Feed widget:** the five newest posts (author, two lines of text, likes, comments) and "Go to Social Hub →".
6. **Personal Todos widget:** every to-do, each with a checkbox. Completing one may open the share dialog ([4.16](#416-social-hub-social-todo-network-integrations-publish-jobs)).
7. **Leaderboard:** the top five. Each row has a rank (medals for the top three), avatar, name, "(You)" on your own row, completed count, a completion bar with its percentage, and the total. Then "+N more".
8. **Recent Tasks:** the five newest tasks, each with priority, due date, status and one action: "Start", "Complete", or the text "Waiting for teammates".

**States**
- Loading is plain text.
- There is no error state: a failed load looks like empty lists.
- Each widget has its own empty text.

**Fix**
- Four different gradient banners, with emoji as icons.
- The leaderboard says "Top performers this month", but the data is all-time and company-wide.
- Nothing links to its details, and there is no "View all tasks".
- The counts don't add up: requested and cancelled tasks have no card.
- "Complete" here is "Request Completion" on Tasks.
- No message after an action, and a double click sends twice.
- Feed avatars ignore profile photos.
- The to-do checkbox has no accessible name.

### 4.10 Tasks (`/tasks`)

**Who sees what**

| | admin | team_leader | team_member, user |
|---|---|---|---|
| Title | "All Tasks" | "My Tasks" (wrong: it lists the team's tasks) | "My Tasks" |
| Lists | every task | tasks with an assignee in their team, plus their own | their own |
| "New Task", Edit, Delete | yes | yes, for tasks they manage | no |
| Approve / Reject | yes | no: they review on `/teams` | no |
| Start / Request Completion | no | wrongly shown on teammates' tasks ([9](#9-bugs-found)) | on their own part |

**Contents**
1. **Hero:** title, "Welcome back, {name}", a progress ring ("{n}% · {completed} of {total} done"), and the badges "N overdue" and "N urgent".
2. **Search and actions:** search ("Search tasks by title, description, or tags...") and "+ New Task".
3. **Status filter pills, with counts:** All, Pending, In Progress, Requested, Completed, Cancelled.
4. **Results line:** "Showing N {filter} tasks" and "Refresh".
5. **Task card grid:** one column, then two, then three as the screen widens.
6. **Pagination:** shown above 10 tasks; 10, 25, 50 or 100 per page.

**Task card** ([Taskscard.tsx](Frontend/src/components/Taskscard.tsx)), top to bottom:
1. Title, priority badge, status badge.
2. Description, cut to two lines.
3. If rejected: "Task Rejected", the reason, and "Rejected by {name} on {date}".
4. Dates: start → due.
5. "Edited by {name} · {time}".
6. An "Overdue" flag.
7. Per-assignee chips ("✓ Name" done, "… Name" still working), shown only when there are two or more assignees.
8. Tags.
9. Actions, which depend on role and state:
   - "Start Task"
   - "Request Completion", or "Request Again" after a rejection
   - "Your part is done. Waiting for teammates"
   - "Awaiting Admin Approval"
   - "Completed"
   - "Cancelled"
   - "Approve" / "Reject"
   - "Edit" / "Delete"

**Task form** (modal, [Tasksadd.tsx](Frontend/src/components/Tasksadd.tsx), used on `/tasks` and `/admin`). Titles "Create New Task" / "Edit Task".

| Field | Type | Required | Notes |
|---|---|---|---|
| Title | text | yes | |
| Description | textarea | yes | |
| Start Date | date | yes | |
| Due Date | date | yes | not before the start date |
| Est. Days | read-only | – | shown one day less than the server's count |
| Priority | four toggle buttons: low, medium, high, urgent | – | default medium |
| Initial Status | static "Pending (default)" | – | create only |
| Assign To | multi-select dropdown with checkboxes, plus removable chips | yes | admins pick from every active user; leaders from their team |
| Tags | text, comma-separated | no | |
| Additional Notes | textarea | no | |

- The form shows one error at a time in a top banner.
- On success it shows "Task created successfully!" and closes after one second.

**Reject dialog:** "Reject Task Completion". The "Rejection Reason" textarea is optional; when it is blank, a default reason is sent. Its "n/500" counter isn't enforced.

**States**
- Loading: a spinner, "Loading your tasks...".
- Error: "Unable to load tasks" with "Retry". Its text tells users to "make sure the backend is running".
- Empty: shown per filter. The same text appears when a search finds nothing.

**Fix**
- Leaders see Start and Request on tasks they aren't assigned to.
- Leaders can't review here.
- The copy says "Admin" even when a leader reviews.
- No sorting, and no priority, assignee or date filters.
- There is no task detail view, so notes, creator, the single assignee's name and estimated days are never shown.
- Cancelled tasks count as urgent and show as overdue.
- A task shows as overdue during its own due day.
- Above 10 per page, the pagination control can disappear.
- There is no way to cancel a task.
- Three copies of the reject dialog exist (here, Admin, Team).

### 4.11 Attendance (`/attendance`)

**Who:** everyone sees their own records. Admins also see everyone's, plus a form to add records and a Delete column. The admin nav doesn't link here.

**Contents**
1. Header: "Attendance Tracking", "Manage attendance records and track working hours." (non-admins see the same "Manage" wording).
2. **Today, four cards:**
   - Today's Status, with an approval badge
   - Check In Time
   - Check Out Time
   - Today's Work Hours ("In progress..." while checked in)
3. **This month:** "Total Working Hours (This Month)".
4. **Quick Actions:** "Check In" and "Check Out". After use they read "✓ Checked In" / "✓ Checked Out".
5. **Messages:**
   - "Checked in successfully. Your attendance is pending approval."
   - "Already checked in today"
   - …and the other check-in/out results
6. **Admin only, "Add Attendance Record":** Employee (select, required), Date (required), Status (Present, Absent, Late, Half Day, Leave), Remarks. Button "Add Record".
7. **"Attendance Records" table:**
   - Columns: Employee, Date, Status with approval badge, Check In, Check Out, Work Hours, Remarks, and Delete (admin).
   - Filter: All, Present, Absent, Late, Half Day, Leave.
   - Refreshes every 30 seconds.

**Fix**
- No loading state: the first paint says "Not Checked In".
- **Admins see someone else's record as "today"**, and their own Check In is disabled once anyone has checked in ([9](#9-bugs-found)).
- Employees can't request leave, a half-day or a day off, although the API supports it.
- The month total counts unapproved records (Profile counts approved only).
- Times show seconds.
- Purple means both "leave" and "pending".
- On a leave day, Check In stays enabled and then fails.
- The table is redundant for non-admins (the Employee column) and scrolls sideways on phones.

### 4.12 Profile (`/profile`)

**Contents**
1. **Hero:**
   - round photo, with a camera button to upload
   - name and email
   - pills: role (raw, for example "team_leader"), "{n} days" as a member, phone
   - "Edit Profile"
2. **Photo preview dialog:** "Update Profile Picture", showing Current → New, with "Confirm Change". The photo must be an image of 5 MB or less; it is resized to 256px.
3. **Edit form** (while editing): Full Name, Email, Phone, and "Save Changes".
4. **Stats:** Total Tasks, Completion %, Avg Hours (approved records), Day Streak.
5. **"Task Progress":** a stacked bar (completed, in progress, pending) with a legend.
6. **"Activity":** a 120-day heatmap in the GitHub style, with "{n} activities in the last 120 days" and Current and Best streak.

**Fix**
- **No password change** anywhere in the app. The API needs the current password and a new one of at least 6 characters, and it signs out other sessions.
- Department is neither shown nor editable.
- There is no "Remove photo".
- Saving shows no confirmation.
- The bar doesn't reach 100% (requested and cancelled are missing).
- The heatmap's 1 and 2 levels share a colour, and its legend is commented out.
- Days are counted in UTC.
- Long names overflow the initials.
- Choosing the same file again does nothing.

### 4.13 Team dashboard (`/teams`, `/team`)

**Who:**
- Home for leaders.
- Also the "create or join" page for a `user` with no team.
- Members are redirected to `/team-member`.
- Admins land on a broken "Create your team" ([9](#9-bugs-found)).

**State A: no team**
- Card "YOUR TEAM" / "Create your team" / "You are not in a team yet. Create one and you will lead it…", with "Create Team".
- **Create Team dialog:** Team Name (required), Description.
- "Or join a team you were invited to": each invite shows the team name and "Invited by {name} · {date}", with "Accept" and "Decline".

**State B: leader dashboard**
1. **Header:** team name and description, with pills for "{n} tasks awaiting approval", "{n} attendance pending" and "{n} invites".
2. **Frozen banner:** "This team is frozen. An admin has paused it…".
3. **Tabs:** overview · tasks · attendance · members · invite.
   - **Overview:**
     - four stat cards: Team Members, Total Tasks, Pending Approvals, Pending Attendance
     - "Tasks Awaiting Your Approval": title, "Requested by {name} · {date}", Approve, Reject
     - "Attendance Requests": name, date, in/out times, Approve, Reject (no reason asked)
   - **Tasks:**
     - "+ Create Task"
     - table: Title (with "Edited by"), Assigned To, Priority, Status, Due, Actions (Edit, Delete, Approve, Reject)
   - **Attendance:**
     - "Pending Requests" list
     - table: Member, Date, Check In, Check Out, Hours, Status
   - **Members:**
     - "+ Invite Member"
     - cards: avatar, name, "Leader" pill, email, department, "Remove"
   - **Invite:** invites sent *to the current user*. This is almost always empty for a leader.

**Dialogs**
- **Reject:** reason, optional.
- **Invite Member:** type a username or user id. The copy reads "This avoids showing a global user list to team leaders." (developer wording).
- **Create Team Task / Edit Task:** Title*, Description*, Assign To* (a native multi-select: "Hold Ctrl/Cmd to select multiple"), Priority, Start Date*, Due Date*. Edit mode adds "Saving a change marks the task as edited by you, with the time."

**Fix**
- Errors and confirmations use native `alert()` and `confirm()`.
- **Invites:**
  - Inviting means typing an exact name, and the first match wins.
  - "Invite" means received invites, while "Invite Member" means sending one.
  - There is no list of the invites a team has sent.
- **Attendance:**
  - The table's Status column shows the day type, never the approval state ([9](#9-bugs-found)).
  - Rejecting attendance asks no reason, unlike rejecting a task.
- **Tasks:**
  - Approve and Reject show on tasks the leader is assigned to; the server refuses.
  - The rejection reason is never shown.
- **Frozen team:** pending counts show 0 instead of "waiting for an admin".
- **Missing:** a link to the team chat, and renaming (it exists only in Chat).
- **Layout:** tables are clipped on phones and the tabs overflow.

### 4.14 Team member dashboard (`/team-member`)

**Contents**
1. **Hero:**
   - "TEAM MEMBER WORKSPACE", then the user's name
   - developer copy ("…without seeing data outside your own scope")
   - stats: Invites, Team (0 or 1), Members
   - buttons: "Open Chat", "Open Social Hub", and "Open My Tasks" (or "Open Attendance" with no team)
2. **"Your invite queue":** team, description, "Invited by {name} on {date}", Accept, Decline.
3. **Current team:** the name, or "No active team".
   - A frozen note when frozen.
   - "TEAM LEADERS" and "TEAM MEMBERS" lists (initials, name, email).
   - With no team: "You are not assigned to a team yet. Accept an invite above…", shown even when there is nothing above.

**Fix**
- Missing: the team's tasks, an attendance summary, and a team chat entry point.
- The "Team 0/1" stat is meaningless.
- It is a second "no team" screen, different from `/teams`.
- People show no photo, presence or "message" button.
- Any loading error looks like "no team".

### 4.15 Chat (`/chat`)

**Layout:** two panes. The left sidebar is fixed at 320px; the conversation is on the right.

**Sidebar**
1. **Dark header:** "PANDAV CHAT", "Messages", "Private chat and team room in one workspace."
   - Tiles: UNREAD (total), ONLINE (everyone connected across the platform), VISIBLE CHATS.
2. **Toggle:** "Direct" / "Team Chat".
3. **Search:** "Search people by name, email, role". It does nothing in team mode.
4. **Context line.**
   - Direct: "Your teammates, your Social Hub connections, and anyone who has messaged you…"
   - Team: "Only the team you belong to is shown here.", with "Manage" or "Create".
5. **List.**
   - **Direct rows:** initials, online dot, name, unread count ("99+" at most), email, role.
   - **Team row:** team name, "{n} people in this group", description.
   - **Loading:** skeleton rows.
   - **Empty:** "No users found…" or "No matching people".

**Conversation** ([Chat.tsx](Frontend/src/components/Chat.tsx))
1. **Header:** name, "Direct conversation" or "Team conversation", and a pill "Tap a message for info".
   - Team mode adds a separate "TEAM ROOM" card above with leaders, member count and "Manage group". This duplicates the header.
2. **Messages:**
   - "Load earlier messages".
   - My bubbles are green, on the right. Theirs are white, on the left.
   - Team messages show the sender's name.
   - Each bubble has the time (HH:MM only) and, on mine, "Sent"/"Read" or "Team sent"/"Seen by N".
3. **Typing indicator:** "{name} is typing", direct messages only.
4. **Strips:** a send error, or the frozen read-only note.
5. **Composer:** a single-line input "Message {name}...", with "Send". Enter sends.

**Dialogs**
- **Message info:** sender, status, read by, sent at, message type, edited.
- **Manage Team Chat Group / Create Your Team:**
  - Group name and Description, with "Save group changes" or "Create team"
  - "Invite a member" (user name or id)
  - a Leaders list
  - a Members list with "Remove" (no confirmation)

**Fix**
- **Phones:** there is no list/conversation switching, so at 375px the conversation is about 7px wide.
- **Wrong conversation on first visit:** someone in a team sees the team chat under the "Direct" tab ([9](#9-bugs-found)).
- **Unread and notifications:**
  - no unread badge in the nav
  - no notification outside `/chat`
  - no unread count for team chat
- **Conversation list:**
  - no last-message preview, and no sorting by most recent
  - "Online" counts the whole platform, not your contacts
  - the list never has department or photos, because the server sends only id, name, email and role
- **Messages:** no date separators.
- **Admins:** can't open any team room.
- **Composer:** single-line, so no new lines, and no 2000-character counter.
- **Connection:** no "reconnecting" state.
- **Accessibility:** bubbles are buttons, which is noisy for screen readers.
- **Message info:** shows the sent time as the edited time.

### 4.16 Social Hub (`/social`, `/todo`, `/network`, `/integrations`, `/publish-jobs`)

**Today:** one long page. All five routes, and `/admin/moderation`, show the same page; the page never
reads the URL.

**Contents**
1. **Dark hero:**
   - eyebrow "Backend aligned V2 workspace"
   - H1 "Social publishing, personal planning, and team networking in one cleaner flow."
   - a paragraph naming API routes
   - buttons "Refresh data" and "Open assigned tasks"
   - stats: Feed posts and My posts (both count only the loaded page), Personal tasks done, Connections
2. **Banners:** an error and a notice, placed under the hero. They can't be dismissed.
3. **Left column**
   - **"Compose update":**

     | Field | Type | Notes |
     |---|---|---|
     | Title | text | optional, 180 characters at most |
     | Visibility | select: Public, Team only, Connections | |
     | Content | textarea | required by the server, 5000 characters at most |
     | Tags | text, comma-separated | up to 20 |
     | Targets | chips: Pandav feed (on), LinkedIn, GitHub | at least one. LinkedIn and GitHub need approval for users and members |

     Button: "Create post".
   - **"Social feed":** post cards, then "Load older posts". A post card shows:
     - avatar, name, role pill, approval pill (it reads "none" on most posts), time
     - title, content
     - chips: visibility, #tags, LinkedIn, GitHub
     - three result tiles (Pandav, LinkedIn, GitHub), always shown, even when they read "none"
     - "Approve" / "Reject" (leaders and admins)
     - GitHub repo field and "Queue publish job"
     - "Like · n", "n comments", the last three comments, a comment box and "Comment"
4. **Right column** (below the feed on screens narrower than 1280px)
   - **"Personal sprint":**
     - form: Task title, Short description, Priority (low, medium, high), Due date, "Offer to share it when completed…", and "Add task"
     - rows: title, priority, status, description, due date, auto-share, post status, "Complete"/"Reopen", "Delete" (no confirmation)
   - **"Connections":**
     - search and "Search"
     - the first six results, each with "Connected", "Pending sent", "Awaiting response" (meaning *they* asked you) or "Connect"
     - "Incoming requests" with "Accept" and "Decline"
   - **"Integrations":** LinkedIn and GitHub cards:
     - "Connected as {handle}" or "Not connected"
     - an access-token field, shown as plain text
     - "Link" and "Preview"
     - Preview prints raw JSON
   - **"Publish jobs":**
     - the first eight jobs: provider, status, post title, "attempts a/max", last error, next retry, completed time
     - "Process" and "Retry"
     - admins also get "Process due jobs"
   - **"Moderation and approvals":**
     - the first four pending posts (read-only)
     - admins also get the five newest posts with the buttons flag, hide, remove and restore
5. **"Share this task?" dialog** ([ShareTaskDialog.tsx](Frontend/src/components/ShareTaskDialog.tsx)):
   - "Everyone in Pandav will see this post…"
   - an editable "Post" (5000 characters at most)
   - "Also post on LinkedIn" (disabled until LinkedIn is linked)
   - "Don't share" and "Share"

   It is used here and on the User dashboard.

**Fix**
- **Structure:** split the page into views chosen by the URL; the routes already exist ([11](#11-suggested-direction)).
- **Bugs:**
  - Approving or rejecting a post probably crashes the page.
  - The server's error messages are never shown.
  - Feed comments show "Unknown user".
  - One failed request on load blanks the whole page.
  - Every action reloads all seven requests and resets the feed paging.
- **Feed accuracy:** hidden, pending, rejected and external-only posts show with no marker.
- **Copy:** developer wording, raw values ("none", "team_member", "flag"), and JSON dumps.
- **Safety:**
  - The access token is typed in plain text, and there is no "Connect" (OAuth) button.
  - "Also post on LinkedIn" is pre-ticked.
  - Removing a post or deleting a to-do has no confirmation.
  - Declining a connection is permanent, with no warning.
  - "Queue publish job" can publish twice.
- **Truncated lists:** they stop at 6, 8, 5, 4 and 3 items with no "show more".
- **Accessibility:**
  - Inputs have no labels.
  - The target chips can't be used with a keyboard.
  - Busy buttons look enabled.
  - Enter doesn't submit search or comments.

**Who sees what**

| | admin | team_leader | team_member / user |
|---|---|---|---|
| Feed | everything except removed posts, including hidden ones (unmarked) | public, own, own team's, connections' | same as leader |
| External posts need approval | no | no | yes |
| Approve / Reject shown | every pending post | every pending post (the server allows only their own team's) | no |
| Publish jobs listed | everyone's | their own only, not those they queued for members | their own |
| "Process due jobs", moderation | yes | no | no |

### 4.17 Admin dashboard (`/admin`)

**Contents**
1. **Header:**
   - "Good Morning/Afternoon/Evening, {name}" and "Here's what's happening with your team today"
   - "Refresh" (it duplicates the top bar's) and "New Task"
2. **Headline figures:**
   - Total Tasks
   - Active Tasks
   - Completion Rate
   - Pending Approvals (counts tasks only)
   - Active Users (active / total)
   - Avg Work Hours (this month, approved; shows "—h" when there is no data)
3. **"Quick Actions":** seven tiles. Seven tiles in a six-column grid leave one alone on the second row. Messages and Teams have no tile.
   - Create Task
   - Team Attendance
   - View User
   - All Tasks
   - Approvals (its badge counts attendance only)
   - Manage Users
   - Moderation (with the flagged count)
4. **Tabs:** Overview · Tasks (n) · Attendance (n pending) · Users (n) · Moderation (n).
   - **Overview:**
     - "Overdue Tasks (n)": the first five, with due date, assignees and priority
     - "Completion Requests": title, "By {name} · {date}", and buttons that are only the glyphs ✓ and ✗
     - "This Week's Summary": tasks completed this week, today's check-ins, completed this month
     - "Today's Check-ins (x/n)"
     - "Team Members": every non-admin, with a status dot
     - "Attendance Requests": the first five, with ✓ and ✗. Reject asks no reason.
   - **Tasks:** a table with Task, Assigned To, Priority, Status, Due Date and actions (Approve, Reject, Edit, Delete). No search, filter or paging.
   - **Attendance:** a table with User, Date, Status (it shows the day type) and Approve / Reject.
   - **Users** (the only user management in the app): a table with Name, Email, Role, Status and actions:
     - "Reset password": a prompt for a new password of at least 6 characters
     - "Disable"/"Enable": no confirmation, although disabling signs the person out
   - **Moderation:** flagged posts (author, date, content, status). "Approve" means unflag; "Reject" means remove, with the fixed reason "Violates community guidelines".
5. **Reject Task dialog:** "Rejection Reason" (optional), with an unenforced "n/500" counter.

**Fix**
- **Loading:**
  - The whole page blanks to "Loading dashboard..." after every action, even Cancel.
  - Loading errors are silent.
- **Approvals:**
  - Attendance rejection asks no reason here but does on `/admin/attendance`.
  - "Approvals" counts attendance; "Pending Approvals" counts tasks.
- **Users tab gaps:** delete, change role, edit details and search are all missing. The API supports them.
- **Moderation:** the verbs differ from the Social Hub's.
- **Tabs:** the chosen tab isn't kept in the URL.
- **Glyph buttons:** ✓/✗ have no accessible name.
- **Double submits:** nothing stops them.

### 4.18 Attendance management (`/admin/attendance`)

**Contents**
1. **Header** (blue-to-green band): "Attendance Management", "View and manage all team attendance", and "Back to Dashboard".
2. **Stats:** Checked In Today, Pending Requests, Team Members, Total Records.
3. **"Pending Approval Requests":** every pending record (name, date, status, check-in), with "Approve" and "Reject". Reject opens the reject dialog.
4. **"Team Overview":** one card per person (Present, Late, Absent, Hours), counting approved records only.
5. **Filters:** User, Status, Approval, Start Date, End Date, and "Clear Filters".
6. **"Attendance Records" table:**
   - Header line: "Showing X of Y records".
   - Columns: User, Date, Status with approval, Check In, Check Out, Work Hours, Remarks (truncated, with no tooltip), Actions.
   - Actions: Approve and Reject while pending, otherwise Edit.
7. **Dialogs:**
   - **"Reject Attendance Request":** "Remark / Reason".
   - **"Edit Attendance Record":** Status, Approval and Remarks, with the check-in, check-out and hours shown read-only.

**Fix**
- **Data loading:** it downloads every record ever, with no paging, sort, export or bulk approve.
- **Duplication:** pending records appear twice, in the queue and in the table.
- **Reject reason:** it overwrites the employee's own remarks.
- **Missing actions:**
  - Times and date can't be edited, although the API allows it.
  - Adding and deleting records live on `/attendance`, which admins aren't linked to.
- **Accessibility:**
  - The filter labels aren't linked to their fields.
  - The subtitle has low contrast.

### 4.19 User view (`/admin/users`, `/admin/userview`)

**Who and what:** read-only, although the nav calls it "Users".

**Contents**
1. **Header:** "User View", a user picker (no label, no search) and "Back".
2. **Profile card:** photo, name, email, role, Total Tasks, Completed, Work Hours.
3. **Tabs:**
   - **Overview:**
     - "Task Summary" (Pending, In Progress, Awaiting Approval, Completed) with a progress bar
     - "Attendance Summary" (Days Present, Days Late, Days Absent, Total Hours) with an attendance-rate bar
     - "Recent Tasks" (five)
   - **Tasks:** a table with Task, Status, Priority, Start Date and Due Date.
   - **Attendance:** a table with Date, Status with approval, Check In, Check Out and Work Hours.

**Fix**
- **Switching people:**
  - The old person's data stays on screen while the new one loads.
  - Switching quickly can show the wrong person.
- **Missing:**
  - an error state
  - a link to one person (`/admin/users/:id`)
  - any actions
- **Wrong numbers:**
  - The attendance rate divides approved days by *all* records.
  - Priority falls back to "low", but the default is "medium".
- **Merge** this page with the Users tab of the admin dashboard ([11](#11-suggested-direction)).

### 4.20 Contact messages (`/admin/messages`)

**Contents**
1. **Header:** "Contact Messages", "Messages sent through the contact form", and "← Back to Dashboard".
2. **Status pills, with counts:** all, new, in progress, resolved, closed.
3. **Error banner** with "Retry". This is the only admin page with one.
4. **Message cards:**
   - subject
   - "{name} · {email} (mail link) · {phone}"
   - date
   - status badge
   - the full message (never shortened)
   - "Resolved by {name} on {date}"
   - a Status select, which saves at once
   - "Reply by email"
   - "Delete", which asks "Delete this message?"

**Fix**
- **Missing:** search, paging, sorting, and a nav badge for new messages.
- **Long messages** never collapse.
- **Status changes** save with no feedback.
- **No messages can arrive** until the contact form is fixed.

### 4.21 Team management (`/admin/teams`)

**Contents**
1. **Header:** "Team Management", "Create and manage teams, assign leaders and members", and "+ Create Team".
2. **Team cards:**
   - name, a "Frozen" pill, description
   - "{n} leaders · {n} members · Created {date}"
   - buttons Invite, Add Leader, Freeze/Unfreeze, Delete
   - leader chips, each with "✕"
   - a member grid, each with "Remove"
   - empty: "No members yet. Invite some!"
3. **Dialogs:**
   - **Create New Team:** Team Name*, Description, Team Leader* (a select of every non-admin).
   - **Invite Member:** a select.
   - **Add Leader:** a select.
4. **Native confirms:**
   - Freeze: "Freeze "{name}"? Its leaders can't add, change or approve anything, and its chat becomes read-only…"
   - Delete: "Delete team "{name}"? This cannot be undone."
   - Remove: "Remove {name} from team?"

**Fix**
- **Pickers:** they offer people the server will refuse: people already in a team, deactivated users, and admins.
- **Frozen teams:** Invite and Add Leader are still offered.
- **Leaders:** "✕" shows on a team's only leader, who can't be removed.
- **Loading errors:** a failure shows "No teams created yet."
- **Missing:**
  - renaming a team
  - seeing a team's tasks, attendance or chat
  - search and filter (for example, frozen teams)
- **Delete confirm:** it doesn't say that the members go back to `user` and that the chat and invites are deleted.
- **Phones:** the button row overflows.

### 4.22 Moderation (`/admin/moderation`)

**Today:** it shows the whole Social Hub page. There is no dedicated moderation view.

**Needs:**
- a list of posts, filtered by status (all, clean, flagged, hidden, removed) and by author
- the reason, with who moderated and when
- the actions flag, unflag, hide, unhide, remove and restore, with an optional reason

The API already supports all of this (it returns up to 200 posts).

---

## 5. Components

### 5.1 What exists in `Frontend/src/components/`

| Component | Used on | Notes |
|---|---|---|
| `Navbar` | everywhere | Public header, plus the signed-in rail, drawer and top bar ([4.0](#40-app-shell-every-screen)) |
| `Footer` | Landing, Pricing | |
| `RequireAuth` | route guard | Spinner while the session is checked |
| `Tasksadd` | Tasks, Admin | Task create/edit dialog |
| `Taskscard` | Tasks | Task card grid |
| `ShareTaskDialog` | Social Hub, User dashboard | Native `<dialog>`: **the pattern to copy** |
| `Pagination` | Tasks | Not responsive; no `aria-current` |
| `Chat` | Chat | Conversation pane |
| `Attendance`, `Contactus` | `/attendance`, `/contact` | Whole pages kept in `components/` |
| `FeedbackContext` (in `context/`) | everywhere | Toasts, plus confirm and prompt dialogs on native `<dialog>` |

### 5.2 The kit the redesign needs, and where each piece is duplicated today

| Component | Needed on | Today |
|---|---|---|
| **Page header** (title, subtitle, actions, optional stats) | every app page | Six patterns: rounded gradient card (User dashboard), full-width gradient hero (Tasks, Profile), blue-to-green band (×3 admin pages), white bar (Team pages), dark hero (Social Hub), plain text (Attendance) |
| **Stat card** | dashboards, Profile, Tasks, Attendance, admin | Copied in at least eight places with different sizes and colours |
| **Data table**, collapsing to cards on phones | admin tasks, attendance, users; Team tasks and attendance; User view; Attendance | About ten tables. All scroll sideways on phones; some are clipped. Header styles differ |
| **Status badge** | everywhere | At least five colour maps that disagree ([6](#6-status-vocabulary)) |
| **Avatar** (photo, initials, presence dot) | nav, lists, chat, posts, leaderboard, teams | Five or more versions. Initials aren't upper-cased or capped, and a broken image is hidden by changing the page directly |
| **Dialog / modal** | forms, rejects, previews, confirms | Hand-made overlays (task form, three reject dialogs, photo preview, attendance reject and edit, team dialogs on three pages, chat manage, message info) with no Escape key or focus trap. Only Feedback and ShareTaskDialog use `<dialog>` |
| **Confirm dialog** | deletes, remove member, freeze, disable user | Feedback confirm on some pages, native `confirm()` on team pages, none on others |
| **Toast / inline banner** | after every action | Feedback toasts; native `alert()` on team pages; inline banners on Social Hub, Chat, Attendance and the task form; many actions give no feedback |
| **Tabs**, kept in the URL | Admin dashboard, User view, Team dashboard, Chat, Social Hub (new) | Plain buttons with no tab semantics; not in the URL |
| **Filter pills / filter bar / search** | Tasks, Attendance, Admin attendance, Contact messages, Chat, Connections | Each built separately |
| **User picker** (search, multi-select, chips) | task form, team task form, invites, add leader, admin create team | A custom dropdown, a native multi-select, native selects, and "type an exact name or id" |
| **Form fields**: text, textarea with an enforced counter, date, select, checkbox, toggle group, file and photo picker | all forms | Labels often unlinked; the "n/500" counters aren't enforced; errors only in a top banner |
| **Empty state** | every list | Mix of emoji tiles, dashed boxes and plain text |
| **Loading** (skeletons) | every page and list | Four styles: plain text, black spinner, green spinner, none |
| **Error state with Retry** | every page | Only on Tasks, Contact messages and Team dashboard |
| **Pagination / "load more"** | Tasks, tables, feed, chat | Client-side pagination on Tasks; "load older" on feed and chat |
| **Progress ring, bar and stacked bar; heatmap** | Tasks, User view, leaderboard, Profile | Built separately each time |
| **Task card**, **task detail** (new) | Tasks, dashboards | Card only; no detail view |
| **Approval item** (approve, reject with reason) | Admin, Team, Tasks, Attendance admin | Four separate implementations |
| **Chat**: conversation row, presence, bubble, day separator (new), typing, composer, message info | Chat | |
| **Social**: post card, comment, composer with target chips, connection row, integration card, job row, moderation row, to-do row | Social Hub, User dashboard | |
| **Leaderboard row**, **invite card**, **member card / chip** | dashboards, teams | Invite cards built twice; member cards three ways |
| **Banner** (frozen, info, warning, error) | Team pages, Chat | Frozen state looks different on each screen |
| **Nav item with badge**, **breadcrumbs**, **avatar menu**, **drawer** | shell | No badges; inaccessible menu and drawer |

---

## 6. Status vocabulary

One table per concept: every value that needs a badge or state, what it looks like now, and what to
fix. Pick one label and one colour per value, and use them everywhere.

### 6.1 Tasks

| Value | Today | Fix |
|---|---|---|
| `pending` | amber "pending" (yellow on Team pages) | |
| `in-progress` | blue "in progress" | |
| `completion-requested` | purple, with five labels: "Requested", "completion requested", "Awaiting Admin Approval", 📤, 🔔 | one label, for example "Awaiting review" |
| `completed` | emerald (green on Team pages) | |
| `cancelled` | grey | only an admin can set it, and no screen can |

**Priority:** `low` (grey on cards, green in the form) · `medium` (blue; the default) · `high`
(orange) · `urgent` (red). Personal to-dos have no `urgent`.

**Each assignee's progress:** `not-started` · `in-progress` · `completion-requested` · `completed`.
Today this is a two-state chip (done or still working), shown only when there are two or more
assignees.

**Derived flags:**
- Overdue
- Due soon (3 days or less)
- Rejected, with reason, who and when
- Edited, with who and when
- "Your part is done, waiting for teammates"

### 6.2 Attendance

There are two independent values, and they need **separate** colour families. Today purple means
both `leave` and `pending`.

| Day type | Today |
|---|---|
| `present` | green (emerald on admin) |
| `absent` | red |
| `late` | yellow (orange on admin) |
| `half-day` | blue (amber on admin, grey in User view) |
| `leave` | purple (blue on admin, grey in User view) |

| Approval | Today |
|---|---|
| `pending` | purple (amber in User view) |
| `approved` | emerald |
| `rejected` | red |

**Derived states:**
- Not checked in
- Checked in, in progress
- Checked out
- Work hours: show units; times without seconds

### 6.3 People and teams

**Role:** `user` · `team_member` · `team_leader` · `admin`.
- Today the raw value is shown ("team_leader", "Team_leader").
- Use labels instead, for example: User, Team member, Team leader, Admin.

**Account:** Active · Inactive. Today this is shown by colour only.

**Team:** Active · Frozen. Today Frozen is shown four different ways.

**Invite:** `pending` · `accepted` · `declined`. Expired invites (after 7 days) are hidden.

**Presence:** online · offline. Today the green dot appears only in the chat list.

### 6.4 Chat

**Direct message:** "Sent" · "Read". **Team message:** "Team sent" · "Seen by N", with names.

**Also needed:**
- an unread count per conversation, and a total for the nav
- a typing indicator
- a read-only (frozen) state
- "reconnecting" (new)

### 6.5 Social Hub

| Concept | Values | Notes |
|---|---|---|
| Post approval | `none` · `pending` · `approved` · `rejected` | Hide `none`; today it shows on most posts |
| Moderation | `clean` · `flagged` · `hidden` · `removed` | Show a marker on hidden posts, and show the reason to the author |
| Visibility | `public` · `team` · `connections` | Raw words today |
| Targets | Pandav feed · LinkedIn · GitHub | Fixed when the post is created |
| Result per target | `none` · `published` · `failed` | Add a link to the LinkedIn post or GitHub issue (stored, never shown) |
| Publish job | `queued` · `processing` · `completed` · `failed` | Plus attempts (n of max), next retry and last error. All grey today |
| Integration | not linked · linked (token) · linked (OAuth) · linked but the token can't be read | Today it is just "Connected" or "Not connected" |
| Connection, per person | none → Connect · request sent · request received → Accept/Decline · connected | A declined pair can never connect again |
| Personal to-do status | `todo` · `in_progress` · `completed` | `in_progress` can't be set from the UI |
| To-do auto-share | `none` · `pending_approval` · `published` · `failed` · `already_generated` | |

### 6.6 Contact messages

`new` (purple) · `in-progress` (blue) · `resolved` (emerald, plus "Resolved by … on …") · `closed`
(grey).

---

## 7. Visual system today

### 7.1 What is defined

**Theme tokens** in [index.css](Frontend/src/index.css):
- Fonts: `--font-headline` Manrope, `--font-body` Inter.
- Colours:
  - `--color-primary #00386c` (navy)
  - `--color-primary-light #1a4f8b`
  - `--color-secondary #515f74`
  - `--color-accent #ffb77e`
  - surface colours `#f7f9fb`, `#eceef0`, `#f2f4f6`, `#e0e3e5`
- A `.bg-primary-gradient` class.

**The written design system** ([Frontend/guide.md](Frontend/guide.md), "The Digital Atrium"):
- primary `#1A4F8B`
- Manrope everywhere
- 4–8px corners
- flat surfaces with 1px borders
- an 8px spacing grid
- functional colours: emerald for success, amber for pending, red for errors, blue for info

**Neither is followed by the app screens.**

### 7.2 What is actually used

There are four visual dialects:

| Dialect | Screens |
|---|---|
| Navy brand, Manrope, glass, 2rem corners, heavy shadows | Landing, Footer. Navbar and Pricing try to use it, with broken classes |
| Neutral grey and emerald, black primary buttons | User dashboard, Tasks, Attendance, Profile, admin pages, About, Services, Contact, Login, Register |
| Grey and blue "classic admin", plain tables | Team dashboard, Team management |
| Slate and sky or emerald glass, 24–32px corners, extra-bold type | Social Hub, Chat, Team member dashboard |

- **Colour use** across `src/`:
  - greys: neutral 797 uses, slate 340, gray 141
  - accents: emerald 254, blue 177, purple 74, the theme's `primary` 38
- **Browser theme colour:** `index.html` and `manifest.json` use emerald `#10b981`. The favicon is an emerald-to-blue gradient, which is not the navy brand.
- **Primary buttons:** black on Tasks, the task form, Login, Contact, About and Services. Green on Register, Profile, dialogs and 404. Blue on Team pages. Sky on the Social Hub.
- **Fonts:** Manrope is used only on Landing and the Footer. Inter loads only weights 400–600, but most headings ask for bold, extra-bold or black, so the browser fakes them. Weight 900 is never loaded.
- **Corners:** `rounded-md` through `rounded-[32px]`, sometimes mixed on one screen.
- **Icons:**
  - `lucide-react` in only three files (Landing, Footer, Social Hub)
  - about 60 hand-pasted SVG icons across ten files
  - emoji used as icons on the dashboards, tabs and cards
  - lucide's brand icons (`Github`, `Linkedin`) are deprecated
- **Motion:**
  - `motion` is used only on Landing.
  - The classes `animate-in fade-in zoom-in-95` and `animate-fade-in` do nothing, because no plugin defines them.
  - Nothing respects reduced-motion settings.
- **Not present at all:** dark mode, per-page `<title>`, and a global `:focus-visible` style.

### 7.3 Tailwind 4 pitfalls that broke the current design

- **`text-[--color-primary]` is invalid in Tailwind 4.** The build turns it into `color:--color-primary`, which browsers drop. This affects 17 classes in the Navbar and Pricing.
  - Use `text-primary` (the theme name) or `text-(--color-primary)` instead.
- **A bare `border` uses the text colour, which is near-black.** Tailwind 4 no longer defaults it to grey.
  - Always give a border colour.
  - Today inputs on Contact, Login and Register have dark borders and no visible focus change.

---

## 8. Cross-cutting problems

### 8.1 Navigation and structure
- "Users" in the admin nav opens a read-only viewer, while real user management sits in a dashboard tab.
- Admin attendance create and delete live on `/attendance`, which admins aren't linked to.
- Five Social Hub routes and `/admin/moderation` all show the same page.
- A team leader's "Dashboard" and "Team" are the same page. Team members have no team link.
- No badges anywhere, so waiting approvals, unread messages, invites and new contact messages are invisible until someone opens the page.
- No detail pages: tasks, posts, people and teams can't be linked to.

### 8.2 The same feature, built several times

| Feature | Where | How they differ |
|---|---|---|
| Approve or reject attendance | Admin overview, Admin attendance tab, Admin attendance page (queue and table), Team dashboard | A reason is asked on one page only |
| Approve or reject a task | Tasks, Admin (two places), Team dashboard | Three copies of the reject dialog |
| Moderation | Admin dashboard tab, Social Hub | Different actions and wording |
| Create a team | Team dashboard, Chat, Admin | Three dialogs; the admin one requires a leader |
| Invite someone | Team dashboard, Chat (both by typing a name or id), Admin (pick from a list) | |
| Remove a member | Team dashboard, Admin (confirm), Chat (no confirm) | |
| Accept an invite | Team dashboard, Team member dashboard | Different follow-up |
| Per-person attendance summary | Admin attendance, User view | Different maths |
| Status and priority colours | User dashboard, Taskscard, Tasksadd, Team dashboard, Admin, Attendance, Admin attendance, User view | All disagree |

### 8.3 Feedback and states
- **Silent loading errors:**
  - Admin dashboard, Admin attendance, User view and User dashboard: the page renders as empty.
  - Team management shows "No teams created yet".
  - Chat shows "No messages yet".
- **Silent actions:** most actions succeed with no feedback (approve, reject, delete, enable or disable, profile save).
- **Native popups:** `alert()` and `confirm()` are still used on the three team pages.
- **Busy buttons:** most are not disabled while working, so double submits are possible.
- **Blanking:** the admin dashboard blanks the whole page after every action.

### 8.4 Phones
- Chat can't be used (fixed 320px sidebar).
- Every table scrolls sideways or is clipped.
- The public site has no menu.
- Pagination and button rows overflow.
- The Social Hub puts everything under up to 50 posts below 1280px.

### 8.5 Accessibility
- **Dialogs:** most have no Escape key, focus trap or dialog semantics.
- **Tabs** have no tab semantics.
- **Unnamed controls:** icon-only and glyph-only buttons (✓, ✗, ×, the camera, the to-do checkbox).
- **Labels:** many are missing or unlinked; the Social Hub uses placeholders only.
- **Colour only:** many status cues rely on colour alone, and emoji carry meaning with no text.
- **Contrast:** grey text on gradients is too light.
- **Keyboard gaps:**
  - The Register photo picker can't be reached.
  - The Social Hub target chips can't be used.
  - The closed mobile drawer's links can still be reached with the Tab key.
- **Live updates:** no `aria-live` for new chat messages.

### 8.6 Copy and content
- **Developer wording shown to users:**
  - "Backend aligned V2 workspace"
  - API paths in descriptions
  - "make sure the backend is running"
  - "This avoids showing a global user list…"
  - "…without seeing data outside your own scope"
- **Raw database values in badges:** "half-day", "team_leader", "none", "flag".
- **Invented or contradictory marketing:** "500+", "hundreds" and "thousands" of teams; "24/7" support next to office hours; features that don't exist.
- **Wording drift:** "Complete" vs "Request Completion"; "team", "team group", "chat group" and "team room" for the same thing.

### 8.7 Dates and times
- **Time zone mismatches:**
  - The browser's "today" uses local time; the server uses Asia/Kolkata.
  - Profile counts activity by UTC day.
  - A task becomes overdue during its own due day (due dates are stored as midnight UTC).
- **Mixed formats:** times with seconds, with no single date format, and no "today" / "yesterday".

---

## 9. Bugs found

Found during this audit. Those marked **checked** were confirmed in the code. The rest come from
reading the code and were not re-checked by running the app.

| # | Where | Bug | |
|---|---|---|---|
| 1 | Contact | The form requires a subject but has no subject field, so it can never be sent | checked |
| 2 | Navbar, Pricing | 17 `[--color-*]` classes are invalid in Tailwind 4: the brand colour never renders, and Pricing's "Most Popular", "Choose Growth" and "Create Account" are white on white | checked |
| 3 | Pricing | The three plan buttons have no action | checked |
| 4 | About, Services | "Get Started" goes to `/login` instead of `/register` | checked |
| 5 | 404 | "Back to dashboard" sends leaders and members to `/user` | checked |
| 6 | Social Hub | Approving or rejecting a post probably crashes the page: the server returns the author without a role, and the card reads `author.role` | checked in code, not run |
| 7 | Social Hub | Server error messages are never shown: 19 handlers check `instanceof Error`, but the API layer rejects with plain objects | checked |
| 8 | Social Hub | Feed comments show "Unknown user": the feed doesn't include commenters' names | checked |
| 9 | Tasks | Leaders see "Start" and "Request Completion" on teammates' tasks; the server refuses them | checked |
| 10 | Attendance | For admins, "today" is whichever record dated today comes first among everyone's records, and month hours add up everyone's hours | checked |
| 11 | Team dashboard | The attendance Status column shows the day type, never the approval state | checked |
| 12 | Team dashboard | Admins land on "Create your team", and creating fails with "leaderId is required" | checked |
| 13 | Chat | On first visit, someone in a team sees the team chat under the "Direct" tab | checked |
| 14 | Chat | The list can never show department or photos: the server sends only id, name, email and role | checked |
| 15 | Profile | There is no password change anywhere; the API call is defined but never used | checked |
| 16 | Shell | "Dashboard" is never highlighted as active | |
| 17 | Shell | Signed-in users on public pages get the app shell drawn over the page | |
| 18 | Public pages | About, Services, Contact and Register start underneath the fixed header | |
| 19 | Admin dashboard | "Avg Work Hours" shows "—h" with no data; the page blanks after every action | |
| 20 | User view | Switching users quickly can show the wrong person's data | |
| 21 | Task form | Estimated days is one less than the server's count | |
| 22 | Tasks | Cancelled tasks count as urgent and show as overdue; Pagination disappears when the page size is larger than the list | |
| 23 | Team dashboard | Approve and Reject show on tasks the leader is assigned to; frozen teams show 0 pending | |
| 24 | Profile | The heatmap's 1 and 2 levels share a colour; activity is counted by UTC day | |
| 25 | Chat | Message info shows the sent time as the edited time | |
| 26 | Social Hub | "Also post on LinkedIn" is pre-ticked; a job can be queued again after it published; the target chips can't be reached by keyboard; a failed "Process" reports nothing | |

---

## 10. Constraints

### 10.1 API

**Keep the existing API.** Each module is documented in [Backend/Doc/](Backend/Doc/): Users, Tasks,
Attendance, Teams, Chat, SocialHub. The base path is `/api/v2`.

**Paging.** These endpoints accept `?page=&limit=` (50 by default, 200 at most), but no screen uses
it yet:
- `GET /tasks`
- `GET /tasks/pending-approval`
- `GET /attendance`
- `GET /users`
- `GET /contact`

Paging the Tasks and Admin attendance pages also needs summary counts from the server; see
[REMAINING_WORK.md §5](REMAINING_WORK.md).

**Small backend changes some designs need:**
- the chat list returning photo and department
- the feed including commenters' names
- the approve response including the author's role
- a "conversations with last message" list for direct chat
- an endpoint for a team's sent invites
- unlinking an integration
- reading the audit log

### 10.2 Field limits the forms should show

| Field | Limit |
|---|---|
| Password | 6 characters or more |
| Profile photo | PNG, JPEG, WebP or GIF, about 200 KB after resizing (5 MB before) |
| Direct or team message | 2000 characters |
| Post title / content | 180 / 5000 characters |
| Post tags | up to 20, each 1–40 characters |
| Post links (media URLs) | up to 10 |
| Comment | 1–600 characters |
| Personal to-do title / description | 160 / 1500 characters |
| Task reject reason, attendance remarks | no limit is enforced (the UI shows /500) |
| Contact form | no limits |

### 10.3 Rate limits the UI should explain

| Action | Limit |
|---|---|
| Failed sign-ins | 10 per 15 minutes per address |
| Sign-ups | 10 per hour |
| Contact form | 5 per hour |
| Social Hub writes | 30 a minute |
| Messages | 45 a minute (chat and Social Hub combined) |
| Linking accounts | 10 a minute |

All of them answer 429 with a `Retry-After` header.

### 10.4 Browser tests that depend on today's names

If the redesign changes these, update [Frontend/e2e/](Frontend/e2e/) (`support/app.ts` and the specs):

- **Login:** the labels "Email", "Password" (exact) and "Remember me", and the button "Sign in".
- **Shell:**
  - the avatar button, named with the user's name, and "Logout"
  - the sidebar link "Team" (exact)
  - after logout the app lands on `/`
- **Dialogs:** confirm dialogs are found by their title (for example "Delete this task?").
- **Teams:**
  - heading "Create your team"; button "Create Team"; label "Team Name"
  - the lowercase tab buttons "members" and "tasks"
  - "+ Invite Member"; placeholder "Username or user id"; "Send Invite"
  - "Accept" leads to `/team-member`
  - "+ Create Task"; labels "Title", "Description", "Assign To", "Start Date", "Due Date"; "Create Task"
  - a table row containing the task, with "Edited by {name}", "Edit", "Delete" and "Save Changes"
  - the test also accepts native browser dialogs, so moving to Feedback confirms means updating it
- **Chat:**
  - a contact is a button named with the person's name, containing the hidden text "online"
  - the placeholder "Message {name}..." and the button "Send"
- **Social Hub:** no browser test covers it yet.

### 10.5 Stack notes
- **Tailwind 4:** define the design tokens in `@theme` and use them by name (`bg-primary`). Avoid the v3 `[--var]` syntax.
- **Dialogs:** use the native `<dialog>` with `showModal()`, as `FeedbackContext` and `ShareTaskDialog` do.
- **Icons:** use `lucide-react` (already installed). Its brand icons are deprecated, so use simple SVG logos for LinkedIn and GitHub.
- **Motion:** use `motion` (already installed), wrapped in `MotionConfig reducedMotion="user"`.

---

## 11. Suggested direction

These are recommendations, not decisions.

### 11.1 Decisions for the project owner

1. **Palette.**
   - The navy brand (`#00386c`, on Landing and in `index.css`)?
   - `guide.md`'s `#1A4F8B`?
   - Or the emerald that most app screens, the favicon and the browser theme colour use?

   Pick one primary colour and one grey scale.
2. **Marketing claims.** Keep, soften or remove the invented figures and the features that don't exist (see [4.1](#41-landing-)–[4.4](#44-pricing-pricing)).
3. **Pricing.** Is it real? If so: per seat or per team, annual billing, and what the buttons do.
4. **Contact page.** Confirm the office hours and the timezone, and set the `VITE_CONTACT_*` details.
5. **Dark mode:** now or later?
6. **Scope.** Should the redesign also add the "API only" features listed in [2](#2-features)? The cheapest high-value ones:
   - password change
   - leave requests
   - task cancel
   - user delete and role change
   - "Connect with LinkedIn/GitHub"

### 11.2 Proposed navigation

| Role | Sidebar |
|---|---|
| Everyone | Home · Tasks · Attendance · Chat (unread badge) · Social Hub · Team (invites badge) |
| Leader, adds | Approvals (badge: tasks, attendance and posts waiting) |
| Admin | Home · Approvals (badge) · People · Teams · Tasks · Attendance · Inbox (new-messages badge) · Moderation (flagged badge) · Chat · Social Hub |

Profile and sign-out move to the avatar menu. Each nav item gets an icon.

### 11.3 Merges and new screens

- **One Approvals inbox** for leaders and admins: tasks, attendance and external posts, with approve and reject-with-reason everywhere. It replaces the four approval surfaces.
- **One People page** for admins: a searchable, paged table with role, status and team, plus a person page (`/admin/users/:id`) that holds today's User view plus edit, role, reset password, disable and delete.
- **Social Hub as tabs chosen by the URL**, using the routes that already exist: Feed (`/social`) · My to-dos (`/todo`) · Network (`/network`) · Integrations (`/integrations`) · Publishing (`/publish-jobs`) · Moderation (`/admin/moderation`, admin).
- **A task detail panel**, opened from any task: every field, per-assignee progress, history (created, edited, rejected, approved), and actions.
- **One Team page** for every role, with tabs (Overview, Tasks, Attendance, People, Chat, Invites). Leaders get the editing controls; members see it read-only. It absorbs `/team-member` and the team parts of Chat.
- **One create-team flow and one invite flow**, with a people search instead of typing exact names.
- **Attendance:** add "Request leave / day off" for everyone, and give admins create and delete on `/admin/attendance`.
- **Chat:** a list view and a conversation view on phones, last-message previews, day separators, unread counts for team chat, and a nav badge.

### 11.4 Order of work

1. **Foundations:**
   - the tokens in `@theme`, one palette and grey scale
   - Manrope and Inter with the right weights
   - a focus style and border defaults
   - the icon set and motion settings
2. **Components:** the kit in [5.2](#52-the-kit-the-redesign-needs-and-where-each-piece-is-duplicated-today), starting with button, field, badge, avatar, dialog, table, empty, loading and error states, and the page header.
3. **App shell:** sidebar with icons and badges, top bar, avatar menu, mobile drawer.
4. **Screens most people use:** Home dashboards, Tasks (with the detail panel), Attendance, Chat.
5. **Team pages and the Approvals inbox.**
6. **Social Hub tabs.**
7. **Admin:** People, Teams, Attendance, Inbox, Moderation.
8. **Public site:** Landing, About, Services, Pricing, Contact, Login, Register, 404.

At each step, fix the bugs in [9](#9-bugs-found) that belong to that screen, and keep
[10.4](#104-browser-tests-that-depend-on-todays-names) passing (or update the tests with the
change).
