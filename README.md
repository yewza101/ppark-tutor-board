# PPark Tutor Board

A real-time collaborative interactive whiteboard web application designed for tutoring and interactive sessions. It supports real-time drawing synchronization, file uploads (PDF/Image), mathematical equation rendering, and role-based access control.

## 🌟 Overview

PPark Tutor Board is a full-stack application split into a React-based frontend and a Node.js/Express backend. It leverages WebSockets for low-latency real-time collaboration across multiple connected clients.

## 🚀 Features & Functions

- **Real-time Collaboration:** Instant synchronization of drawing strokes, viewport updates, and cursor movements across all connected users in a board using Socket.io.
- **Interactive Canvas:** Built with Fabric.js, supporting freehand drawing, shapes, text, and element manipulation (select, move, delete, update).
- **Action History:** Support for Undo actions.
- **Rich Media & Math:** 
  - Import PDF documents and Images onto the canvas.
  - Render mathematical equations using KaTeX.
  - Export the board to PDF or Image formats.
- **Performance Optimized:** Implements an in-memory caching mechanism (`boardCache.js`) to buffer real-time stroke data before flushing to the database, reducing database write loads.
- **Role-based Authentication:** Differentiates between 'admin' and 'student' roles. Admins have oversight capabilities (e.g., viewing active boards).

## 🏗️ Architecture & Services

The project is structured as a monorepo with `frontend` and `backend` directories.

### Frontend
- **Framework:** React 19 + Vite
- **Canvas Engine:** Fabric.js (v7)
- **State Management:** Zustand
- **Real-time Communication:** Socket.io-client
- **Styling:** Tailwind CSS (v4)
- **Utilities:** Axios (HTTP client), html2canvas / jspdf (exporting), pdfjs-dist (PDF rendering), KaTeX (Math rendering), Lucide React (Icons).

### Backend
- **Server:** Node.js with Express 5
- **Real-time Server:** Socket.io
- **File Uploads:** Multer (Memory Storage)
- **Authentication:** JSON Web Tokens (JWT) & bcrypt

## 🗄️ Database & Storage

The application utilizes **Supabase** (PostgreSQL) for data persistence and file storage.

### Database Schema
- **`users` Table:** Stores user credentials and roles.
  - `id` (Primary Key)
  - `username` (Unique)
  - `password_hash`
  - `role` ('admin' or 'student')
- **`boards` Table:** Stores the canvas data state for each user.
  - `id` (Primary Key)
  - `user_id` (Foreign Key -> users)
  - `canvas_data` (JSON/Text representation of the board state)

### Storage
- **Supabase Storage Bucket (`board-assests`):** Used to store uploaded images and files which are then embedded onto the canvas via public URLs.

## 🔒 Security

- **Authentication:** API endpoints are protected using JWT (JSON Web Tokens).
- **Password Protection:** User passwords are encrypted and hashed using `bcrypt` (10 salt rounds) before being stored in the database.
- **Role-Based Access Control (RBAC):** Distinct roles (`admin`, `student`) to restrict access to administrative endpoints and functions.
- **Secure File Uploads:** Upload limits (10MB max) implemented via Multer to prevent denial-of-service via large payloads.

## 🛠️ Getting Started & Deployment

### Prerequisites
- Node.js (v18+)
- Supabase Project (Database and Storage Bucket named `board-assests`)

### 1. Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables. Create a `.env` file in the `backend` directory:
   ```env
   PORT=3001
   JWT_SECRET=your_super_secret_jwt_key
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your_supabase_anon_or_service_key
   ```
4. Run the Supabase schema script (`supabase_schema.sql`) in your Supabase SQL editor to create the necessary tables and initial admin account.
5. Start the backend server:
   ```bash
   npm start # or node server.js
   ```

### 2. Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Ensure the frontend is configured to point to your backend API URL (default is usually `http://localhost:3001` for local development).
4. Start the development server:
   ```bash
   npm run dev
   ```
5. The application will be accessible at `http://localhost:5173`.
