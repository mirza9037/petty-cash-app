# Petty Cash System - Tabba Heart Institute

![Tabba Heart Institute](public/tabba-logo.svg)

A modern, secure web application for managing petty cash expenses, specifically built for the **FMES Department** at Tabba Heart Institute.

## 🚀 Live Demo
The application is deployed on Vercel and can be accessed here:
**[https://petty-cash-app-nu.vercel.app](https://petty-cash-app-nu.vercel.app)**

## ✨ Features

### 🔐 Authentication
- Secure staff sign-in via Supabase Authentication
- Role-based access control (Creator, HOD, CFO)

### 📊 Dashboard
- **Summary Cards** — Total Outstanding Balance, Pending Approvals, and Total Expenses This Month at a glance
- **Expense Reports Table** — All reports with S.No, Date, Submitted By, Total Expenses (PKR), Outstanding Balance (PKR), Status, and Actions
- **Status Badges** — Color-coded indicators: Draft (grey), Submitted (yellow), HOD Approved (blue), CFO Approved (green)
- **Role-Based Actions** — Edit, HOD Approve, CFO Approve, and View buttons appear based on the logged-in user's role
- **"+ New Report"** button to create a new expense report

### ✅ Approval Workflow
A multi-level approval pipeline for expense reports:
1. **Creator** (`aftab@thi.com`, `idrees@thi.com`) — Creates and submits expense reports
2. **HOD** (`zeeshan@thi.com`) — Reviews and approves submitted reports → status becomes `hod_approved`
3. **CFO** (`arshad@thi.com`) — Final approval → status becomes `cfo_approved`

Approval buttons show a loading spinner during the update and the table refreshes automatically without a full page reload.

### 📝 New Expense Report
- Report header with institution, department, date, and submitter selection
- Balance summary with previous balance, cash received, total expenses, and outstanding balance
- Line items table with description, section, category, and amount
- Section subtotals and grand total calculated automatically
- Save as Draft or Submit for Approval

### 📄 Report Detail & PDF Export
- **Printable Layout** — Two-column header with org info and balance summary
- **Grouped Line Items** — Items grouped by section with subtotal rows and a grand total row
- **Signature Section** — Three signature blocks for Senior Manager FMES, HOD FMES, and CFO
- **PDF Export** — One-click export to A4 PDF using `html2canvas` and `jsPDF`, saved as `expense-report-[date].pdf`

### 🎨 Design
- Responsive, mobile-friendly interface
- Official Tabba Heart Institute branding (logos, colors, typography)
- Montserrat font family with clean, professional styling
- Subtle animations and hover effects

## 🛠️ Tech Stack
- **Frontend**: React 19, Vite, React Router
- **Backend & Auth**: Supabase (PostgreSQL + Auth)
- **PDF Generation**: html2canvas + jsPDF
- **Styling**: Vanilla CSS with branded design variables
- **Deployment**: Vercel

## 📁 Project Structure
```
src/
├── components/
│   └── Navbar.jsx          # Top navigation bar with logo and logout
├── lib/
│   └── supabase.js         # Supabase client configuration
├── pages/
│   ├── Dashboard.jsx       # Main dashboard with cards, table, approval workflow
│   ├── Login.jsx           # Authentication page
│   ├── NewReport.jsx       # Create new expense report form
│   └── ReportDetail.jsx    # Report detail view with PDF export
├── App.jsx                 # Root component with routing and auth
├── index.css               # Global styles and design tokens
└── main.jsx                # Application entry point
```

## 💻 Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/mirza9037/petty-cash-app.git
cd petty-cash-app
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Variables
Create a `.env` file in the root directory. You can copy the provided example:
```bash
cp .env.example .env
```
Ensure your `.env` file contains your Supabase credentials:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```
*(Note: Never commit your actual `.env` file to version control. It is excluded via `.gitignore`.)*

### 4. Start the development server
```bash
npm run dev
```
The app will typically be available at `http://localhost:5173`.

## 📦 Deployment
This project is configured for seamless deployment on **Vercel**. 
1. Connect your GitHub repository to Vercel.
2. Ensure the environment variables (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`) are added in your Vercel project settings under **Settings > Environment Variables**.
3. Push to the `main` branch to trigger an automatic deployment.

## 📄 License
© Tabba Heart Institute · Internal System · Authorized Personnel Only
