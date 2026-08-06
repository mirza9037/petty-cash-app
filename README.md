# Petty Cash System - Tabba Heart Institute

![Tabba Heart Institute](public/tabba-logo.svg)

A modern, secure web application for managing petty cash expenses, specifically built for the **FMES Department** at Tabba Heart Institute.

## 🚀 Live Demo
The application is deployed on Vercel and can be accessed here:
**[https://petty-cash-app-nu.vercel.app](https://petty-cash-app-nu.vercel.app)**

## ✨ Features
- **Secure Authentication**: Staff sign-in is managed securely via Supabase Authentication.
- **Responsive Design**: A sleek, full-width, mobile-friendly interface styled with modern CSS.
- **Branded UI**: Incorporates official Tabba Heart Institute branding (logos, favicons, typography, and color schemes).
- **Dashboard**: A central hub for staff to manage their petty cash workflow (Feature currently in active development).

## 🛠️ Tech Stack
- **Frontend**: React 19, Vite, React Router
- **Backend & Auth**: Supabase
- **Styling**: Vanilla CSS with customized, branded design variables
- **Deployment**: Vercel

## 💻 Local Development Setup

To run this project locally on your machine, follow these steps:

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