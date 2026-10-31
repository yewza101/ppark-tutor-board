# 📋 PPark Tutor Board — Complete System Architecture & Handoff Document

> **เอกสารส่งมอบงานและคู่มือโครงสร้างระบบฉบับสมบูรณ์ (HANDOFF.md)**  
> **ปรับปรุงล่าสุด:** ตุลาคม 2026  
> **สถานะโครงการ:** พร้อมใช้งานบน Production (Active / Production-Ready)

---

## 📑 สารบัญ (Table of Contents)
1. [บทนำและวัตถุประสงค์ (Overview & Purpose)](#1-บทนำและวัตถุประสงค์-overview--purpose)
2. [สถาปัตยกรรมระบบโดยรวม (System Architecture)](#2-สถาปัตยกรรมระบบโดยรวม-system-architecture)
3. [โครงสร้างฐานข้อมูลและระบบจัดเก็บไฟล์ (Database & Storage Schema)](#3-โครงสร้างฐานข้อมูลและระบบจัดเก็บไฟล์-database--storage-schema)
4. [เอ็นจินกระดานวาดภาพ (Canvas & Drawing Subsystem)](#4-เอ็นจินกระดานวาดภาพ-canvas--drawing-subsystem)
5. [ระบบสื่อสาร Real-time (WebSocket Protocol)](#5-ระบบสื่อสาร-real-time-websocket-protocol)
6. [ระบบ Voice Chat & WebRTC (Voice Communication)](#6-ระบบ-voice-chat--webrtc-voice-communication)
7. [ระบบสำหรับคุณครูและการจัดการห้องเรียน (Teacher & Classroom Management)](#7-ระบบสำหรับคุณครูและการจัดการห้องเรียน-teacher--classroom-management)
8. [ระบบสำหรับนักเรียนและการติดตามคุณครู (Student Experience & Track Teacher)](#8-ระบบสำหรับนักเรียนและการติดตามคุณครู-student-experience--track-teacher)
9. [ระบบเอกสาร ใบงาน และการจัดการ PDF (Documents & Media Management)](#9-ระบบเอกสาร-ใบงาน-และการจัดการ-pdf-documents--media-management)
10. [ประวัติการแก้ไขบั๊กสำคัญและการออกแบบเฉพาะทาง (Critical Fixes & Engineering Decisions)](#10-ประวัติการแก้ไขบั๊กสำคัญและการออกแบบเฉพาะทาง-critical-fixes--engineering-decisions)
11. [คู่มือการติดตั้งและการดีพลอย (Setup & Deployment Guide)](#11-คู่มือการติดตั้งและการดีพลอย-setup--deployment-guide)
12. [ตารางอ้างอิง API & Socket Events (API Reference)](#12-ตารางอ้างอิง-api--socket-events-api-reference)

---

## 1. บทนำและวัตถุประสงค์ (Overview & Purpose)

**PPark Tutor Board** เป็นเว็บแอปพลิเคชันกระดานไวท์บอร์ดสอนหนังสือออนไลน์แบบ Real-time แบบอินเตอร์แอคทีฟ ออกแบบขึ้นโดยมุ่งเน้นการใช้งานจริงในห้องเรียนกวดวิชา และการสอนสดแบบกลุ่มย่อย/กลุ่มใหญ่ โดยเฉพาะบน **iPad และ Apple Pencil** 

### จุดเด่นหลักของระบบ:
* **Zero-Latency Collaborative Drawing:** วาดพร้อมกันระหว่างครูและนักเรียนได้แบบเรียลไทม์ ลายเส้นคมชัดเป็นธรรมชาติด้วย Perfect Freehand
* **Multi-Board Live Monitor (ระบบส่องจอนักเรียนแบบเรียลไทม์):** คุณครูสามารถดูหน้าจอกระดานของนักเรียนทุกคนในกลุ่มพร้อมกันแบบตาราง Grid และคลิกเข้าไปสอน/ตรวจงานได้ทันที
* **Integrated WebRTC Voice Chat:** ระบบคุยเสียงผ่านไมค์ในตัว ไม่ต้องพึ่งพาโปรแกรมภายนอก (เช่น Discord หรือ Zoom) พร้อมแสดงคลื่นเสียงแบบเรียลไทม์ และปุ่มควบคุมไมค์เด็ก
* **Native Apple Pencil & Touch Optimization:** รองรับแรงกด (Pressure Sensitivity), ระบบ Palm Rejection แท้จริง (วางสันมือเขียนบน iPad เส้นไม่หาย ไม่ลั่นซูม), Smart Shape Recognition แปลงรูปวาดเรขาคณิตอัตโนมัติ
* **Track Teacher:** ระบบค้นหาและเลื่อนมุมมองตามหาคุณครูสำหรับนักเรียน พร้อมระบบเลื่อนตามอัตโนมัติเมื่อเพิ่งเข้าห้อง

---

## 2. สถาปัตยกรรมระบบโดยรวม (System Architecture)

ระบบเป็น Full-Stack Monorepo แบ่งออกเป็น 2 ส่วนหลัก:

```mermaid
graph TD
    ClientStudent["Student Client (iPad/Browser)"] <-->|HTTPS / REST API| Backend["Node.js / Express Server"]
    ClientTeacher["Teacher Client (PC/iPad)"] <-->|HTTPS / REST API| Backend
    ClientStudent <-->|Socket.IO (WebSocket)| Backend
    ClientTeacher <-->|Socket.IO (WebSocket)| Backend
    ClientStudent <-->|WebRTC P2P Mesh (Voice Audio)| ClientTeacher
    Backend <-->|Supabase Client| SupabaseDB[("Supabase PostgreSQL")]
    Backend <-->|S3 API| SupabaseStorage[("Supabase Storage: board-assests")]
    Backend <-->|In-Memory Cache| BoardCache["In-Memory Board State & Debounce Engine"]
```

### 2.1 เทคโนโลยีฝั่ง Frontend (`/frontend`)
* **Framework:** React 19 + Vite (Rolldown engine)
* **Styling:** Tailwind CSS + Lucide React Icons
* **Real-time Client:** Socket.io-client
* **State Management:** Zustand (`useAuthStore.js` สำหรับจัดการ Token, User Session, Roles)
* **Canvas Engine:** HTML5 Canvas แบบ Custom 2 ชั้น (Base Canvas + Draft Canvas) ผสานกับอัลกอริทึม `perfect-freehand`
* **PDF & Documents:** `pdfjs-dist` (ประมวลผล PDF เวกเตอร์เป็น Canvas), `jspdf` (ส่งออกกระดานเป็น PDF — วาดลง Canvas เองแล้วฝังเป็นภาพ ไม่ได้ใช้ `html2canvas`)
* **Audio / WebRTC:** Web Audio API (`AudioContext`, `AnalyserNode`) + RTCPeerConnection กับ Google STUN Servers

### 2.2 เทคโนโลยีฝั่ง Backend (`/backend`)
* **Runtime:** Node.js (v18+)
* **Framework:** Express 5
* **Real-time Engine:** Socket.IO v4 (รองรับ WebSocket Payload บีบอัดอัตโนมัติ, Buffer สูงสุด 100MB)
* **Authentication:** JSON Web Tokens (JWT) + Bcrypt สำหรับแฮชรหัสผ่าน
* **File Uploads:** Multer (Memory Storage) ส่งตรงขึ้น Supabase Storage
* **Data Layer:** Supabase Client (`@supabase/supabase-js`) ทำงานร่วมกับ In-Memory Cache เพื่อลดภาระการเขียนฐานข้อมูล

---

## 3. โครงสร้างฐานข้อมูลและระบบจัดเก็บไฟล์ (Database & Storage Schema)

ระบบใช้งาน **Supabase (PostgreSQL)** พร้อม Storage Bucket:

### 3.1 ตาราง `users` (ผู้ใช้งานในระบบ)
| Field | Type | Attributes | Description |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | รหัสผู้ใช้งาน |
| `username` | TEXT | UNIQUE, NOT NULL | ชื่อผู้ใช้สำหรับล็อกอิน |
| `password_hash` | TEXT | NOT NULL | รหัสผ่านแฮชด้วย bcrypt (10 rounds) |
| `role` | TEXT | CHECK (role IN ('admin', 'student')) | บทบาท ('admin' สำหรับครู, 'student' สำหรับนักเรียน) |
| `teacher_code` | TEXT | NULLABLE | รหัสประจำตัวคุณครูสำหรับล็อกอินเข้าสอน |
| `group_name` | TEXT | DEFAULT 'General' | กลุ่ม/ห้องเรียนของนักเรียน เช่น 'Room A', 'Math 1' |
| `teacher_id` | INTEGER | REFERENCES users(id) | รหัสของคุณครูที่เป็นเจ้าของนักเรียนคนนี้ |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | วันเวลาที่สร้างบัญชี |

> [!NOTE]
> บัญชี Master Admin มีสิทธิ์พิเศษในการลงทะเบียนคุณครูใหม่ และล้างกระดาน/เอกสารทั้งหมดเมื่อจบเทอม
> ชื่อผู้ใช้/รหัสผ่านอ่านจาก `MASTER_ADMIN_USERNAME` / `MASTER_ADMIN_PASSWORD` / `MASTER_ADMIN_CODE` ใน `backend/.env`
> (เดิมฮาร์ดโค้ดเป็น `adminpark`/`adminpark` ไว้ในซอร์สโค้ด ซึ่งเท่ากับเผยรหัสผ่านแอดมินทั้งระบบไว้ใน Git)
> `teacher_id` ของนักเรียนเป็นตัวกำหนดว่าคุณครูคนไหนเข้าถึงกระดานของนักเรียนคนนั้นได้ ทั้งทาง REST และ WebSocket

### 3.1.1 ความปลอดภัยของ Socket (Socket Authentication)
ทุก Socket ต้องส่ง JWT เดียวกับที่ REST API ใช้ ผ่าน `handshake.auth.token`
เซิร์ฟเวอร์จะปฏิเสธการเชื่อมต่อที่ไม่มี Token (`connect_error: unauthorized`)
และ **`role` ถูกอ่านจาก Token เท่านั้น ไม่เชื่อค่าที่ไคลเอนต์ส่งมาใน payload อีก**

| กฎ | รายละเอียด |
|---|---|
| เข้าห้องได้เฉพาะที่มีสิทธิ์ | นักเรียนเข้าได้แค่กระดานตัวเอง + กระดานครู / ครูเข้าได้แค่นักเรียนที่ `teacher_id` ตรงกับตน (Master เข้าได้ทุกคน) |
| เขียนได้แค่ห้องที่เข้าอยู่ | ทุก event ตรวจว่า `boardId` ตรงกับห้องที่ socket นั้น join ไว้จริง |
| คำสั่งระดับกลุ่ม = ครูเท่านั้น | `teacher-clear-room`, `teacher-upload-sheet`, `broadcast-elements`, `force-presentation`, `admin-mute-user` |
| ยืนยันการเข้าห้อง | เซิร์ฟเวอร์ตอบ `board-joined` เมื่อสำเร็จ และ `join-board-denied` เมื่อถูกปฏิเสธ |

### 3.2 ตาราง `boards` (ข้อมูลกระดานไวท์บอร์ด)
| Field | Type | Attributes | Description |
|---|---|---|---|
| `id` | SERIAL | PRIMARY KEY | รหัสบันทึกกระดาน |
| `user_id` | INTEGER | UNIQUE, REFERENCES users(id) ON DELETE CASCADE | ID ของนักเรียนที่เป็นเจ้าของกระดาน |
| `canvas_data` | TEXT | JSON String | Array ของ Elements ทั้งหมดบนกระดาน (Strokes, Shapes, Images) |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | เวลาอัปเดตกระดานล่าสุด |

### 3.3 Supabase Storage Bucket: `board-assests`
* ใช้จัดเก็บรูปภาพ ใบงาน และหน้าที่แปลงจาก PDF ที่ผู้ใช้แทรกลงกระดาน
* ตั้งค่าการเข้าถึงเป็น **Public Read** เพื่อให้ผู้ใช้ทุกคนในห้องสามารถโหลดภาพแสดงผลได้ทันที

---

## 4. เอ็นจินกระดานวาดภาพ (Canvas & Drawing Subsystem)

หัวใจของหน้ากระดาน [Board.jsx](file:///c:/Users/User/Desktop/PPark2/frontend/src/pages/Board.jsx) เป็นระบบ Double Canvas ที่พัฒนาขึ้นมาเฉพาะ:

```
┌────────────────────────────────────────────────────────┐
│ Container (Pointer Events, Pan, Pinch Zoom, Shortcuts) │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │ 1. Base Canvas (canvasRef)                     │   │
│   │    - เรนเดอร์เส้นที่เซฟแล้ว, แผ่น PDF, รูปภาพ   │   │
│   │    - เรนเดอร์เฉพาะเมื่อ Elements เปลี่ยนแปลง    │   │
│   └────────────────────────────────────────────────┘   │
│   ┌────────────────────────────────────────────────┐   │
│   │ 2. Draft Canvas (draftCanvasRef)               │   │
│   │    - เรนเดอร์เส้นที่กำลังลากสดๆ (In-Progress)  │   │
│   │    - เรนเดอร์เส้นของเพื่อนคนอื่น (Remote Paths)│   │
│   │    - เรนเดอร์เลเซอร์ที่กำลังจาง (Laser Fade)   │   │
│   │    - เรนเดอร์กรอบ Lasso Selection              │   │
│   └────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

### 4.1 คุณสมบัติของ Canvas
* **Infinite Coordinates (พิกัดไร้ขอบเขต):** พิกัดการวาด $(x, y)$ บนกระดานเป็นอิสระจากความกว้างหน้าจอ โดยแปลงด้วยสูตร:
  $$\text{ScreenX} = x \times \text{zoom} + \text{pan.x}$$
  $$\text{ScreenY} = y \times \text{zoom} + \text{pan.y}$$
* **Natural Stroke Smoothing:** ใช้ไลบรารี `perfect-freehand` คำนวณขอบเขตของเส้นและแรงกดของ Apple Pencil ทำให้เส้นเรียบเนียน ไม่แตกเป็นมุมหัก
* **Smart Shape Recognition (ตรวจจับรูปทรงอัตโนมัติ):** เมื่อผู้ใช้วาดเส้นค้างไว้ประมาณ 800ms ระบบจะตรวจจับและแปลงเป็นรูปทรงเรขาคณิตที่แม่นยำอัตโนมัติ:
  - เส้นตรง (Line) / มุม (Angle)
  - สามเหลี่ยม (Triangle) / สี่เหลี่ยม (Rectangle / Polygon)
  - วงกลม (Circle)
* **เครื่องมือครบวงจร:** ดินสอ (Pencil), ปากกาไฮไลท์โปร่งแสง (Highlighter), เลเซอร์พอยเตอร์จางหายเอง 3 วินาที (Laser), ข้อความ (Text), ยางลบเฉพาะจุด (Pixel Eraser), ยางลบทั้งชิ้น (Object Eraser), วงกลม, สี่เหลี่ยม, เส้นตรง, สามเหลี่ยม
* **Lasso Selection & Transformations:** วงเลือกวัตถุเพื่อ ย้าย (Move), หมุน (Rotate), ย่อ-ขยาย (Scale), คัดลอก (Duplicate), ล็อค (Lock), เปลี่ยนสีพร้อมกัน (Bulk Color Change)
* **Isolated Per-User Undo/Redo:** ระบบ Undo ถูกออกแบบแยกตาม `author` ของแต่ละคน ผู้ใช้ A สั่ง Undo จะย้อนเฉพาะเส้นของตนเอง ไม่ไปลบงานของครูหรือเพื่อนคนอื่น

---

## 5. ระบบสื่อสาร Real-time (WebSocket Protocol)

การประสานข้อมูลทั้งหมดเกิดขึ้นผ่าน Socket.IO บน [backend/server.js](file:///c:/Users/User/Desktop/PPark2/backend/server.js):

### 5.1 ห้องกระดาน (Board Rooms)
* แต่ละกระดานจะถูกจัดเป็นห้อง `board_[boardId]`
  - กระดานส่วนตัวของนักเรียน: `board_12` (ตาม `user.id`)
  - กระดานกลางของครู: `board_teacher_board_[group]` หรือ `board_teacher_board`

### 5.2 Server-Side In-Memory Cache (`boardCache.js`)
* เพื่อไม่ให้ฐานข้อมูล Supabase ถูกกระหน่ำเขียนตามความถี่ของลายเส้น (หลายสิบเส้นต่อวินาที)
* ทุกครั้งที่มีเหตุการณ์ `draw-stroke`:
  1. เซิร์ฟเวอร์จะ Broadcast ไปยังผู้ใช้อื่นในห้องทันทีด้วย `socket.to(...).emit('draw-stroke')`
  2. ข้อมูลเส้นจะถูก Append เข้า Array ในหน่วยความจำ `boardStates[boardId]`
  3. ระบบตั้งตัวจับเวลาหน่วงเวลา **Debounce Save 2 วินาที** ก่อนสั่งเขียน `upsert` ลงตาราง `boards` ใน Supabase เพียงครั้งเดียว

### 5.3 รายการ Socket Events ที่สำคัญ
* `join-board`: แจ้งเซิร์ฟเวอร์ว่าเข้าร่วมกระดานใด พร้อมระบุบทบาท (`admin` หรือ `student`)
* `draw-progress`: ส่งตำแหน่งเส้นร่างที่กำลังลากอยู่แบบสด (~13 FPS) เพื่อให้เห็นเส้นกำลังเคลื่อนไหว
* `draw-stroke`: ยืนยันการวาดเส้นเสร็จสมบูรณ์ 1 เส้น (ยกปากกา)
* `update-element`: ปรับปรุงวัตถุที่มีอยู่ (เช่น ย้าย ย่อ ขยาย หมุน หรือเปลี่ยนสี)
* `delete-element`: ลบวัตถุออกจากกระดาน (ใช้กับ Object Eraser และ Per-user Undo)
* `clear-canvas`: สั่งล้างกระดานทั้งแผ่น
* `teacher-clear-room`: คำสั่งพิเศษสำหรับครู สั่งล้างกระดานของนักเรียนทุกคนในกลุ่มพร้อมกัน
* `cursor-move`: ตำแหน่งเมาส์และปากกาของแต่ละคน (มีสีและชื่อกำกับ)
* `viewport-update`: ตำแหน่ง Pan & Zoom ปัจจุบันของผู้ใช้
* `force-presentation`: ครูสั่งเปิดโหมดถ่ายทอดสด (PIP Mode) บังคับนักเรียนแสดงจอครู

---

## 6. ระบบ Voice Chat & WebRTC (Voice Communication)

ระบบคุยเสียงถูกสร้างในคอมโพเนนต์ [GlobalVoiceWidget.jsx](file:///c:/Users/User/Desktop/PPark2/frontend/src/components/GlobalVoiceWidget.jsx) ซึ่งถูก Mount ไว้นอก `<Routes>` ใน `App.jsx` ทำให้เสียงไม่ตัดขาดแม้จะสลับหน้าระหว่างกระดาน

```mermaid
sequenceDiagram
    participant S as Student Client
    participant SRV as Socket.IO Server
    participant T as Teacher Client

    Note over S,T: แยกห้องคุยเสียงตามกลุ่ม (voice_group_[group])
    S->>S: ผู้ใช้กดปุ่ม 'เปิดไมค์คุย' (User Gesture)
    S->>S: ขอสิทธิ์ getUserMedia & ปลดล็อก AudioContext ทันที
    S->>SRV: emit('join-voice', { boardId, username })
    SRV-->>S: emit('existing-voice-users', [usersInRoom])
    SRV-->>T: emit('user-joined-voice', { socketId, username })
    S->>T: WebRTC Offer (ผ่าน Server Signaling)
    T->>S: WebRTC Answer (ผ่าน Server Signaling)
    S<-->T: แลกเปลี่ยน ICE Candidates (Google STUN)
    Note over S,T: สื่อสารเสียงแบบ P2P Audio Stream สำเร็จ
```

### 6.1 จุดสำคัญของการคุยเสียง
* **iOS / iPadOS Safari Compatibility:** เรียก `getUserMedia()` โดยตรงภายใน Event Handler ของการกดปุ่ม (User Gesture Token) ป้องกัน Safari ปฏิเสธการเข้าถึงไมโครโฟน
* **Fallback Constraints:** พยายามขอไมค์แบบคุณภาพสูง (`echoCancellation`, `noiseSuppression`, `autoGainControl`) หากอุปกรณ์เก่าหรือไม่รองรับ จะ Fallback ไปใช้ `{ audio: true }` อัตโนมัติ
* **Real-time Volume Visualizer:** คำนวณคลื่นเสียงด้วย Web Audio API ให้วงแหวนไมค์มีเอฟเฟกต์สีเขียวเต้นตามความดังเสียงพูด และแสดงแถบคลื่นเสียง
* **Room Separation:** แยกห้องเสียงตามกลุ่มอย่างแม่นยำ `voice_group_[group]` โดยครูมี Dropdown ให้เลือกสลับห้องเสียงไปคุยกับกลุ่มต่างๆ ได้ทันที
* **Teacher Remote Control:** คุณครูสามารถดูรายชื่อนักเรียนในห้องเสียง และกดปุ่ม `admin-mute-user` เพื่อสั่งปิดไมค์นักเรียนที่มีเสียงรบกวนได้

---

## 7. ระบบสำหรับคุณครูและการจัดการห้องเรียน (Teacher & Classroom Management)

หน้าควบคุมหลักของคุณครูอยู่ที่ [AdminDashboard.jsx](file:///c:/Users/User/Desktop/PPark2/frontend/src/pages/AdminDashboard.jsx):

### 7.1 ระบบสิทธิ์และคุณครู (Teacher Accounts)
* **Master Admin (`adminpark`):** ดูแลระบบภาพรวม สามารถสร้างบัญชีคุณครูคนใหม่ พร้อมกำหนด Teacher Code และล้างข้อมูลทั้งระบบเมื่อปิดภาคเรียน
* **Regular Teacher (ครูประจำห้อง):** ล็อกอินด้วย Teacher Code ของตนเอง จะมองเห็นเฉพาะนักเรียนที่ตนเองสร้างหรือได้รับมอบหมายเท่านั้น ไม่เห็นนักเรียนของครูคนอื่น

### 7.2 Multi-Board Monitor (กระดานจำลองส่องเด็ก)
* คุณครูสามารถกด **Monitor Group** เพื่อเข้าสู่หน้า [GroupMonitor.jsx](file:///c:/Users/User/Desktop/PPark2/frontend/src/pages/GroupMonitor.jsx)
* หน้าจอจะแสดงหน้ากระดานจำลอง [MiniBoard.jsx](file:///c:/Users/User/Desktop/PPark2/frontend/src/components/MiniBoard.jsx) ของนักเรียนทุกคนในกลุ่มพร้อมกันแบบตาราง Grid
* กระดาน MiniBoard ซิงก์เส้นวาดสดทันที ทำให้ครูเห็นว่าเด็กกำลังเขียนอะไร ติดตรงไหน
* มีไฟสถานะระบุว่านักเรียนกำลังออนไลน์อยู่บนกระดานหรือไม่
* ครูสามารถกดคลิกที่กระดานของนักเรียนคนใดก็ได้ เพื่อกระโดดเข้าไปช่วยสอนในกระดานของเด็กทันที

### 7.3 แถบสลับกระดานด่วนสำหรับครู ([TeacherShortcutBar.jsx](file:///c:/Users/User/Desktop/PPark2/frontend/src/components/TeacherShortcutBar.jsx))
* เมื่อครูเข้าไปในกระดานของนักเรียน จะมีแถบลอยอยู่ด้านล่างหน้าจอ
* มีปุ่มสลับไปยังกระดานกลางของครู (`Teacher Board`)
* มีปุ่มรายชื่อนักเรียนในกลุ่มที่กำลังออนไลน์ ครูสามารถกดสลับไปตรวจงานเด็กคนถัดไปได้ในคลิกเดียวโดยไม่ต้องกดย้อนกลับ Dashboard

### 7.4 Live Presentation Mode (โหมดถ่ายทอดสด)
* เมื่อครูกดปุ่ม **Live Presentation** บน Toolbar กระดานของครู ระบบจะกระจายสัญญาณ `force-presentation`
* หน้าจอของนักเรียนทุกคนจะมีหน้าต่างเล็กแบบ **Picture-in-Picture (PIP)** เด้งขึ้นมาที่มุมขวาล่าง ฉายหน้าจอที่คุณครูกำลังสอนสดๆ ทันที

---

## 8. ระบบสำหรับนักเรียนและการติดตามคุณครู (Student Experience & Track Teacher)

### 8.1 การเข้าสู่กระดานของนักเรียน
* เมื่อนักเรียนล็อกอิน ระบบจะนำทางไปยังกระดานส่วนตัวทันที `/board/:studentId` (ซึ่ง `studentId` คือ `user.id` ตัวเลข)
* นักเรียนมีปุ่มสลับไป-มาระหว่าง **"กระดานส่วนตัว"** และ **"บอร์ดครู"** (`/board/teacher_board_[group]`)

### 8.2 ระบบ Track Teacher (ตามหาตำแหน่งคุณครู)
กระดานไวท์บอร์ดเป็นระบบ Infinite Canvas หากนักเรียนเข้ามาแล้วครูเขียนอยู่อีกพิกัดหนึ่ง นักเรียนอาจเห็นหน้าจอว่างเปล่า ระบบนี้จึงเข้ามาแก้ปัญหานี้:
1. **Auto-Track เมื่อเข้าบอร์ดใหม่:** ระบบจะตรวจสอบตำแหน่งครูหรือเนื้อหาล่าสุด และเลื่อนหน้าจอ (Pan & Center) ไปหาครูทันทีโดยอัตโนมัติ 1 ครั้ง
2. **ปุ่ม "🎯 หาตำแหน่งครู (Track Teacher)":**
   - มีไฟสถานะสีเขียวกระพริบ (Pulse) เมื่อคุณครูกำลังเขียน/ขยับเมาส์อยู่บนกระดาน (`🎯 หาคุณครู (กำลังสอน)`)
   - ระบบค้นหาแบบ 5 ระดับ (Multi-tier fallback):
     1. พิกัดเคอร์เซอร์หรือปากกาของคุณครู ณ เวลานั้น
     2. เส้นที่ครูกำลังลากอยู่
     3. พิกัดหน้าจอ (Viewport) ล่าสุดที่ครูมองอยู่
     4. ลายเส้นหรือโจทย์ล่าสุดที่เขียนโดยครู
     5. วัตถุล่าสุดบนกระดานโดยรวม
   - เมื่อกดปุ่ม หน้าจอจะเคลื่อนไปหาครู พร้อมวงแหวนเรดาร์สีม่วงอินดิโก้กระพริบระบุตำแหน่ง
3. **Off-screen Banner:** หากครูกำลังเขียนอยู่นอกพื้นที่หน้าจอของเด็ก จะมีป้ายแจ้งเตือนลอยขึ้นมาด้านล่าง: *"คุณครูกำลังสอนอยู่นอกจอ แตะเพื่อตามไปดู 🎯"*

---

## 9. ระบบเอกสาร ใบงาน และการจัดการ PDF (Documents & Media Management)

* **Upload Images:** อัปโหลดรูปภาพ PNG, JPG เข้าสู่กระดานโดยอัปโหลดผ่าน `/api/upload` ขึ้น Supabase Storage และนำ URL มาวาดลงบนกระดาน
* **Import PDF Worksheet:**
  - ใช้ `pdfjs-dist` อ่านเอกสาร PDF จากเครื่องของผู้ใช้โดยตรงในเบราว์เซอร์
  - แปลงแต่ละหน้าของ PDF ออกมาเป็นภาพความละเอียดสูงบน Canvas
  - วางลงบนกระดานเป็น Background Page ที่มีสถานะ `isPage: true` และ `locked: true`
  - ป้องกันไม่ให้นักเรียนเผลอใช้ยางลบลบแผ่นใบงานทิ้ง หรือเลื่อนกระดาษโจทย์หลุดตำแหน่ง
* **Clipboard Paste:** รองรับการก็อปปี้รูปภาพจากที่อื่น (PrintScreen หรือ Copy Image) แล้วกด `Ctrl+V` หรือเลือก Paste จากเมนูคลิกขวาเพื่อวางลงกระดานได้ทันที
* **Export Board:** ส่งออกกระดานเป็นไฟล์ภาพหรือ PDF คุณภาพสูงสำหรับให้นักเรียนเก็บไว้อ่านทบทวน

---

## 10. ประวัติการแก้ไขบั๊กสำคัญและการออกแบบเฉพาะทาง (Critical Fixes & Engineering Decisions)

> [!IMPORTANT]
> หัวข้อนี้บันทึกบั๊กซับซ้อนที่ได้รับการแก้ไขอย่างถูกต้อง เพื่อป้องกันไม่ให้ผู้พัฒนาในอนาคตเผลอแก้โค้ดย้อนกลับไปจุดที่ผิดพลาด:

### 10.1 ปัญหาสันมือโดนจอขณะเขียน Apple Pencil แล้วเส้นหาย (Palm Rejection)
* **ปัญหาเดิม:** เมื่อวางสันมือเขียนบน iPad ระบบได้รับ Event ทั้งจาก Pen และ Touch พร้อมกัน ทำให้ `activePointers.size === 2` ระบบจึงเข้าใจผิดว่าเป็นท่าทาง **"ซูมสองนิ้ว"** และล้าง `draftCanvas` เส้นที่กำลังเขียนจึงหายไปทันที และพอยกมือขึ้นระบบไปสั่ง `handleUndo()` ลบเส้นก่อนหน้าทิ้งซ้ำอีก
* **วิธีแก้ที่ถูกต้อง:**
  - สร้าง `activePointerTypeRef` บันทึกประเภทตัวชี้
  - หาก `activePointerType.current === 'pen'` ให้**เพิกเฉยต่อ Touch สันมือทั้งหมด**
  - ท่าทางซูมสองนิ้วและแตะสองนิ้ว Undo จะทำงานก็ต่อเมื่อเป็น **Touch ทั้งสองจุดเท่านั้น** และต้องไม่มี Pen แตะจออยู่

### 10.2 ปัญหาไมโครโฟนนักเรียนเปิดไม่ได้บน iOS / iPadOS Safari
* **ปัญหาเดิม:** การขอสิทธิ์ไมโครโฟน (`getUserMedia`) ถูกวางไว้ใน `useEffect` หลังจาก Re-render ซึ่งทำให้หลุดออกจาก Call Stack ของการกดปุ่ม ทำให้เบราว์เซอร์ Safari บล็อกการเข้าถึงไมโครโฟน
* **วิธีแก้ที่ถูกต้อง:**
  - ย้ายคำสั่ง `navigator.mediaDevices.getUserMedia(...)` และ `AudioContext.resume()` มาไว้ในคำสั่ง `onClick={handleJoinVoice}` โดยตรงใน User Gesture
  - เพิ่ม Fallback constraints หากอุปกรณ์ไม่รองรับการตัดเสียงขั้นสูง ให้ fallback ไปยัง `{ audio: true }`

### 10.3 ปัญหากดกลับกระดานส่วนตัวแล้วเด้งหลุดไปหน้า Login (403 Forbidden)
* **ปัญหาเดิม:** ปุ่มกลับกระดานส่วนตัวสั่ง `navigate('/board/' + user.username)` ซึ่งเป็น String ชื่อผู้ใช้ แต่ Backend ใน [board.js](file:///c:/Users/User/Desktop/PPark2/backend/routes/board.js) ตรวจสอบเฉพาะตัวเลข `parseInt(userIdParam, 10)` ทำให้ได้ `NaN` จึงตอบกลับ 403 Forbidden และหน้าเว็บเด้งกลับไป `/login`
* **วิธีแก้ที่ถูกต้อง:**
  - ปรับการนำทางเป็น `navigate('/board/' + user.id)`
  - ปรับ Backend ให้รองรับทั้ง `username` และ `id` ของนักเรียนเอง จะไม่มีทางติด 403

### 10.4 ปัญหาปุ่มฝั่งซ้ายขยายทับ Toolbar เครื่องมือบนหน้าจอ iPad
* **ปัญหาเดิม:** ปุ่ม Back to Dashboard, Monitor, Track Student มีข้อความยาว ทำให้บนหน้าจอแท็บเล็ต ปุ่มซ้ายกับทูลบาร์ตรงกลางขยายมาชนกัน
* **วิธีแก้ที่ถูกต้อง:**
  - ปรับเป็น Adaptive Responsive Icon Pills (แสดงเฉพาะไอคอนและ Tooltip บนแท็บเล็ต/มือถือ และแสดงข้อความเฉพาะบนจอเดสก์ท็อปขนาดใหญ่ `hidden xl:inline`)
  - ย้ายแถบลอยแจ้งเตือนครูออกนอกจอลงมาไว้ด้านล่างหน้าจอ (`bottom-20`) ไม่ให้ทับเครื่องมือสี

### 10.5 รอบตรวจโค้ดทั้งระบบ (ตุลาคม 2026) — บั๊กที่พบและแก้แล้ว

> [!IMPORTANT]
> ทุกข้อในหัวข้อนี้แก้แล้วและผ่าน build / lint / self-check แล้ว

#### A. ความปลอดภัย (Security)

| ปัญหา | ผลกระทบเดิม | แก้ไข |
|---|---|---|
| Socket ไม่มีการยืนยันตัวตนเลย | ใครก็เปิด WebSocket แล้วยิง `teacher-clear-room` ล้างกระดานเด็กทั้งห้องได้ | บังคับ JWT ใน handshake + ตรวจสิทธิ์ทุก event |
| `JWT_SECRET` มีค่า fallback อยู่ในโค้ด | ปลอม Token แอดมินได้ | เอา fallback ออก ไม่ตั้ง = ไม่สตาร์ต |
| `adminpark`/`adminpark` ฮาร์ดโค้ด | รหัสผ่านแอดมินทั้งระบบอยู่ใน Git | ย้ายไป env + ลบ backdoor `admin123` |
| `POST /clear-all-documents` ไม่เช็ค Master | ครูคนไหนก็ลบกระดาน+ไฟล์ทั้งระบบได้ | ใส่ `requireMaster` |
| ครูใหม่ได้รหัสร่าม `default-teacher-password` | รู้ชื่อครู = ล็อกอินเป็นครูคนนั้นได้ | สุ่ม hash ต่อคน ล็อกอินได้แค่ Teacher Code |
| `GET /api/boards/:id` ไม่เช็คเจ้าของ | ครู A อ่านกระดานนักเรียนของครู B ได้ | เช็ค `teacher_id` |
| `POST /api/upload` ไม่ต้องล็อกอิน | ใครก็อัปไฟล์ขึ้น bucket, อัป HTML/SVG = stored XSS | ต้องมี Token + whitelist เก้พาะรูปภาพ + ไม่ใช้ชื่อไฟล์จากไคลเอนต์ |
| นักเรียนกด Clear บนกระดานครูได้ | ล้างกระดานทั้งกลุ่ม | ซ่อนปุ่ม + กันทั้ง client และ server |

#### B. บั๊กที่ทำให้ฟีเจอร์ไม่ทำงาน (Broken Features)

| ปัญหา | อาการ | แก้ไข |
|---|---|---|
| ปุ่ม "เข้ากระดานสอน" ใช้ `username` แต่นักเรียนใช้ `group_name` | **ครูกับนักเรียนอยู่คนละห้อง ไม่เห็นกันเลย** | เปลี่ยนเป็น dropdown เลือกกลุ่ม ใช้ `group_name` ให้ตรงกัน |
| `teacher-clear-room` / `teacher-upload-sheet` query ตาราง `students` ที่ไม่มีอยู่ | กดล้างกระดานทั้งห้อง = ไม่เกิดอะไรขึ้น | เปลี่ยนเป็นตาราง `users` + จำกัดเฉพาะนักเรียนของครูคนนั้น |
| `supabase` ไม่ถูก import ใน `Board.jsx` | **วางรูปจาก Clipboard พังทั้งหมด** (ReferenceError) | ใช้ `/api/upload` ที่มีอยู่แล้ว |
| PIP ฮาร์ดโค้ด `teacher_board` | นักเรียนกลุ่มอื่นเห็นจอเปล่า | ใช้กระดานตามกลุ่มของนักเรียน |
| `force-presentation` broadcast ทั้งเซิร์ฟเวอร์ | ครูห้องหนึ่งเปิดนำเสนอ เด็กทุกห้องเด้ง PIP | แยกตามกลุ่ม + เคลียร์ให้เมื่อครูหลุด |
| `isPresentationMode` เช็ค `=== 'teacher_board'` | ปุ่ม Live Presentation ไม่ทำงานบนกระดานกลุ่ม | ใช้ `startsWith` |
| ปุ่ม Clear เช็ค `username === studentId` | **ปุ่มไม่โผล่เลย** (boardId เป็นตัวเลขตาม fix 10.3) | เทียบกับ `user.id` |
| `{student.name}` แต่ API ส่ง `username` | ปุ่มรายชื่อเด็กในแถบล่างว่างเปล่า | ใช้ `username` |
| MiniBoard อ่าน `pt[0]` แต่ points เป็น `{x,y}` | **ภาพตัวอย่างกระดานเด็กที่ออฟไลน์ขึ้นว่างเปล่า** | อ่าน `pt.x`/`pt.y` |
| MiniBoard ไฟสถานะดู socket ของครูเอง | ไฟเขียวทุกช่องตลอด ไม่มีความหมาย | ดูจาก `active-boards` + viewport heartbeat จริง |
| MiniBoard โชว์ debug overlay `SYNCED / P: / Z: / E:` | ตัวเลข debug ขึ้นทับจอครูบน production | ลบออก |
| `TeacherShortcutBar` early-return ก่อน `useEffect` | ผิด Rules of Hooks (lint error) อาจ crash เมื่อ role เปลี่ยน | ย้าย return ลงหลัง hooks |
| เครื่องมือ Text แตะแล้วตกไป branch ของ shape | สร้าง element ข้อความเปล่ามองไม่เห็น ค้างในกระดาน | เปิดช่องพิมพ์แทน |
| `showToast` เขียน state ที่ไม่มีใคร render | กด Undo 2 นิ้วแล้วไม่มี feedback อะไรเลย | render toast จริง |
| PDF ส่งทั้ง `draw-stroke` ต่อหน้า และ `canvas-update` ทั้งกระดาน | หน้าใบงานซ้ำบนเครื่องคนอื่น | ส่งแค่ทางเดียว |
| `pdf.worker` ดึงจาก cdnjs | เน็ตโรงเรียนบล็อก CDN = นำเข้า PDF พังเงียบ ๆ | bundle worker มาในโปรเจกต์ |
| วาง/คัดลอกเส้นตรง ไม่ขยับ `x2,y2` | เส้นที่ paste ออกมาบิดเบี้ยว | ขยับทุกจุด |
| `JSON.parse(localStorage)` ไม่มี try/catch | ข้อมูลเสีย = จอขาวถาวร เข้าแอปไม่ได้ | ครอบ try/catch + ล้าง Token ที่หมดอายุ |
| ไม่มี Route Guard | พิมพ์ `/admin` ตรง ๆ แล้วหน้า dashboard ขึ้นมาเลย | เพิ่ม `RequireAuth` |
| `selectstart` preventDefault ที่ `document` | เลือก/คัดลอกข้อความในแอปไม่ได้เลยทั้งแอป | จำกัดเฉพาะ container ของกระดาน |

#### C. ประสิทธิภาพและหน่วยความจำ (Performance & Memory)

| ปัญหา | ผลกระทบเดิม | แก้ไข |
|---|---|---|
| `pastStates` / `futureStates` ไม่มีใครอ่าน | **เก็บ snapshot กระดานทั้งใบทุกเส้น (ทั้งของตัวเองและของคนอื่น) โดยไม่มีใครใช้ → RAM บวมจนแท็บค้าง** | ลบทิ้ง (undo ใช้ `author` + `myRedoStack` อยู่แล้ว) |
| `JSON.parse(JSON.stringify(elements))` ทุกครั้งที่แตะจอใน select mode | clone กระดานทั้งใบก่อนจะขยับอะไร | `slice()` พอ เพราะ element ถูกแทนที่ ไม่ได้ถูก mutate |
| Canvas ไม่คูน `devicePixelRatio` | **เส้นบน iPad เรนเดอร์ที่ 1x แล้วถูกยืด → เบลอ** | คูน dpr (cap ที่ 2) ทั้ง Board และ MiniBoard |
| `getElementBoundingBox` สร้าง `<canvas>` ใหม่ทุกครั้งที่วัดข้อความ | สร้าง DOM canvas ที่ 60fps | ใช้ context เดียวร่วมกัน |
| `requestAnimationFrame` ต่อ pointermove 1 ครั้ง | Apple Pencil ยิง ~240 ev/s → คิว redraw ท่วม | coalesce เหลือ 1 frame |
| ลาก selection = emit ต่อ element ต่อ frame | 40 ชิ้น ≈ 640 msg/วินาที | รวมเป็น `update-elements` ก้อนเดียว |
| ยางลบ emit ต่อเส้นต่อ step | ลบทับเส้นเยอะ = ยิง socket ถล่ม | รวมเป็นก้อน flush ต่อเฟรม + จำกัด interpolation ที่ 64 step |
| `boardStates` ไม่มีเพดาน | กระดานเดียวโตได้ไม่จำกัดจนเซิร์ฟเวอร์ OOM | cap 20,000 elements |
| `studentConnectionCount` ไม่ลดเมื่อย้ายกระดาน | เด็กที่ไปบอร์ดครูยังขึ้น "online" บนกระดานตัวเองตลอดไป | ลดค่าตอนออกจากห้องเก่า |
| `bcrypt.hashSync` / `compareSync` | บล็อก event loop ~100ms ทุกครั้งที่ล็อกอิน = ทุกคนที่กำลังวาดสะดุด | เปลี่ยนเป็น async |
| `loadingPromises` เก็บ promise ที่ reject ไว้ | DB สะดุดครั้งเดียว = กระดานนั้นพังถาวรจนรีสตาร์ต | `try/finally` |
| `clear-canvas` ระหว่างโหลดถูก DB ทับ | สั่งล้างแล้วเส้นเก่ากลับมา | ไม่ทับค่าที่มีในแคชแล้ว |
| dead code | `ScreenShare.jsx`, `VoiceChat.jsx`, `useSocketStore.js`, `out.js`, `debug.js`, `test-rotate.js`, `update_board.js` ไม่มีใครเรียก | ย้ายออก (อยู่ใน `.attic/` และใน git history) |
| dependency ที่ไม่ได้ใช้ | `fabric` (ใหน่มาก), `katex`, `html2canvas` | ถอดออกจาก `package.json` |

#### D. Voice / WebRTC

| ปัญหา | ผลกระทบเดิม | แก้ไข |
|---|---|---|
| `join-voice` ถูกยิง 2 ครั้ง (ทั้งใน onClick และใน useEffect) | เซิร์ฟเวอร์ส่ง `existing-voice-users` ซ้ำ → รื้อ-สร้าง peer connection ใหม่กลางสาย เสียงกระตุก | ยิงครั้งเดียว ติดตามด้วย `joinedRoomRef` + เซิร์ฟเวอร์กัน join ซ้ำ |
| cleanup ของ effect หยุด mic track | **สลับห้องเสียง = ไมค์ดับ** แล้วขอ `getUserMedia` ใหม่นอก user gesture → iPad ปฏิเสธ (บั๊กเดียวกับ 10.2 กลับมาทางอ้อม) | แยก `teardownPeers()` (ปิดแค่ peer) ออกจาก `cleanup()` (ปิด session) |
| `getUserMedia` ยังอยู่ใน `useEffect` | ขัดกับหลักการที่ 10.2 แก้ไว้ | เหลือเฉพาะใน `handleJoinVoice` (user gesture) |
| ICE `disconnected` = ลบ peer ทันที | wifi กระตุกแวบเดียว = เสียงหลุดถาวรทั้งที่ฟื้นเองได้ | รอเฉพาะ `failed` + `restartIce()` + หน่ง 8 วิ |
| `join-board` ตอน reconnect ใช้ห้องที่ค้างจาก closure | reconnect แล้วกลับเข้าห้องเสียงเดิมผิดห้อง | อ่านจาก ref |
| ไม่มี TURN | นักเรียนหลัง NAT แบบ symmetric / firewall โรงเรียน ต่อเสียงไม่ได้เลย | รองรับ TURN ผ่าน env (ดู §11.2) |
| ไม่ปล่อย mic / AudioContext ตอน unmount | ไฟไมค์ค้างติด | เพิ่ม cleanup ตอน unmount |

#### E. แบนด์วิดท์ (Bandwidth)

`draw-progress` ส่ง **points ทั้งเส้นที่สะสมมา** ซ้ำทุก 75ms ตลอดเวลาที่ลากเส้น
เส้นที่มี 594 จุด ถูกส่งซ้ำ 66 ครั้ง = ส่งจริง ~20,000 จุด ทั้งที่ควรส่งแค่ 594 จุด

วัดจริง (ครู 1 + นักเรียน 10 คน):

| | เดิม | หลังแก้ (delta) |
|---|---|---|
| เส้นเดียว 5 วินาที | 7.5 MB | 294 KB |
| คาบ 1 ชม. (300 เส้น) | ~843 MB | ~52 MB |

นี่คือสาเหตุที่ quota ของ hosting เต็ม ไม่ใช่เพราะแพลตฟอร์ม

**วิธีแก้:** ส่งเฉพาะจุดที่เพิ่มมาตั้งแต่ครั้งก่อน (`append: true`) ฝั่งรับเอามาต่อท้าย
คนที่เข้าห้องกลางคันจะเห็นเส้นไม่ครบแค่ช่วงที่ยังลากไม่เสร็จ พอยกปากกา `draw-stroke` จะส่งเส้นเต็มมาให้เอง
มี self-check ที่ `frontend/test-draw-progress.cjs` กันการต่อเส้นผิด

### 10.6 ข้อจำกัดที่ยังเหลือ (Known Limitations)

1. **Voice เป็น P2P Mesh** — นักเรียน N คนต้องถือ N-1 connection ต่อคน เหมาะกับกลุ่มเล็ก (~6-8 คน) ห้องใหย่ควรเปลี่ยนไป SFU (LiveKit / mediasoup)
2. **ยังไม่มี TURN server จริง** — ต้องสมัครแล้วใส่ค่าใน env เอง แก้ด้วยโค้ดอย่างเดียวไม่ได้
3. **Rate limiting เก็บใน memory** — ป้องการ brute-force Teacher Code แล้ว (30 ครั้ง/15 นาที/IP) แต่ค่าอยู่ใน RAM ของแต่ละ instance ถ้า scale เกิน 1 instance ต้องย้ายไป Redis
4. **กระดานครูเก็บใน memory เท่านั้น** — เซิร์ฟเวอร์รีสตาร์ต = กระดานครูหาย (เป็นการออกแบบเดิม ถ้าต้องการให้คงอยู่ ต้องถอดเงื่อนไข `isTeacherBoardId` ใน `boardCache.js`)
5. **แต่ละหน้าเปิดหลาย socket** — Board + MiniBoard แต่ละช่อง + Voice Widget แยก socket กันหมด หน้า Monitor ที่มีเด็ก 20 คนจะเปิด 20+ connection ยังทำงานได้ แต่ถ้าจะลด ควรรวมเป็น socket เดียวแล้ว multiplex ด้วย room

---

## 11. คู่มือการติดตั้งและการดีพลอย (Setup & Deployment Guide)

### 11.1 ความต้องการขั้นต่ำของระบบ
* **Node.js:** v18.0.0 หรือใหม่กว่า (แนะนำ Node v20+)
* **Database:** บัญชี Supabase พร้อม PostgreSQL Database และ Storage Bucket ชื่อ `board-assests`

### 11.2 การตั้งค่าตัวแปรสภาพแวดล้อม (Environment Variables)

> [!IMPORTANT]
> **ตัวแปรที่เพิ่มใหม่ (ต้องตั้งก่อน Deploy)** — ดูไฟล์ตัวอย่างที่ `backend/.env.example` และ `frontend/.env.example`
> * `JWT_SECRET` **บังคับ** เซิร์ฟเวอร์จะไม่สตาร์ทถ้าไม่ตั้ง (เดิมมีค่า fallback ที่อยู่ในซอร์สโค้ด ใครก็ปลอม Token แอดมินได้)
> * `MASTER_ADMIN_PASSWORD` / `MASTER_ADMIN_CODE` **ต้องตั้งถ้าจะใช้บัญชี Master Admin** (เดิมฮาร์ดโค้ด `adminpark`/`adminpark` ไว้ในโค้ด) ถ้าไม่ตั้ง บัญชี Master จะถูกปิดใช้งาน ครูทั่วไปยังล็อกอินด้วย Teacher Code ได้ปกติ

#### Backend (`/backend/.env`):
```env
PORT=3001

# บังคับ: สร้างด้วย node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=

SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your_supabase_service_role_or_anon_key

# บัญชี Master Admin (เว้นว่าง = ปิดใช้งานบัญชีนี้)
MASTER_ADMIN_USERNAME=adminpark
MASTER_ADMIN_PASSWORD=
MASTER_ADMIN_CODE=
```

#### Frontend (`/frontend/.env`):
```env
VITE_API_URL=https://your-backend-domain.up.railway.app

# ไม่บังคับ แต่แนะนำมาก: ถ้ามีแค่ STUN นักเรียนที่อยู่หลัง NAT แบบ symmetric
# หรือ Firewall โรงเรียน จะต่อเสียงหากันไม่ได้เลย
# VITE_TURN_URL=turn:turn.example.com:3478
# VITE_TURN_USERNAME=
# VITE_TURN_CREDENTIAL=
```

### 11.3 คำสั่งรันในเครื่องพัฒนา (Local Development)

```bash
# 1. ติดตั้ง Dependencies และรัน Backend
cd backend
npm install
node server.js
# Backend รันที่ http://localhost:3001

# 2. ติดตั้ง Dependencies และรัน Frontend
cd ../frontend
npm install
npm run dev
# Frontend รันที่ http://localhost:5173
```

### 11.4 การทดสอบ Build ก่อนขึ้น Production
```bash
# 1. ตรวจไวยากรณ์ Backend
node -c backend/server.js
node -c backend/routes/board.js
node -c backend/routes/admin.js
node -c backend/routes/auth.js
node -c backend/boardCache.js

# 2. Self-check ของ board cache (ไม่ต้องต่อ DB จริง)
#    ครอบเคส: DB ล่มแล้วแคชพัง, clear ระหว่างโหลด,
#    canvas_data ที่ encode ซ้อน, กระดานครูต้องไม่ถูกเขียนลง DB, debounce save
node backend/test-boardcache.js

# 3. Lint (ต้องไม่มี error — มีแต่ warning ได้)
npm --prefix frontend run lint

# 4. ทดสอบคอมไพล์ Frontend
npm --prefix frontend run build
```

---

## 12. ตารางอ้างอิง API & Socket Events (API Reference)

### 12.1 REST API Endpoints

#### Authentication (`/api/auth`)
* `POST /api/auth/login`: เข้าสู่ระบบสำหรับนักเรียน และ Master Admin
* `POST /api/auth/login-teacher`: เข้าสู่ระบบสำหรับคุณครูด้วย Teacher Code

#### Whiteboard (`/api/boards`)
* `GET /api/boards/:userId`: ดึงข้อมูล elements ทั้งหมดของกระดาน (ต้องมี JWT Token)

#### Admin & Teacher Management (`/api/admin`)
* `GET /api/admin/students`: ดึงรายชื่อนักเรียน (ครูทั่วไปเห็นเฉพาะนักเรียนตนเอง, Master เห็นทั้งหมด)
* `POST /api/admin/students`: เพิ่มนักเรียนใหม่เข้าสู่กลุ่ม
* `PUT /api/admin/students/:id/password`: เปลี่ยนรหัสผ่านของนักเรียน
* `DELETE /api/admin/students/:id`: ลบบัญชีนักเรียน
* `GET /api/admin/active-boards`: รายชื่อ ID ของกระดานที่นักเรียนกำลังเปิดใช้งานอยู่
* `POST /api/admin/register-teacher`: ลงทะเบียนคุณครูคนใหม่ (เฉพาะ Master Admin)
* `GET /api/admin/teachers`: รายชื่อคุณครูทั้งหมด (เฉพาะ Master Admin)
* `DELETE /api/admin/teachers/:id`: ลบบัญชีคุณครู (เฉพาะ Master Admin)
* `POST /api/admin/clear-all-documents`: ล้างแคชกระดาน เอกสาร และภาพทั้งหมดเพื่อเริ่มเทอมใหม่ (ไม่ลบบัญชีผู้ใช้)

#### Media Upload (`/api/upload`)
* `POST /api/upload`: อัปโหลดภาพหรือไฟล์ขึ้น Supabase Storage (Multipart/form-data, สูงสุด 10MB)

---

### 12.2 Socket.IO Real-time Events Matrix

| Event Name | Direction | Payload Structure | Description |
|---|---|---|---|
| `join-board` | Client → Server | `{ boardId }` | เข้าร่วมห้องกระดาน (`role` อ่านจาก JWT ไม่เชื่อ payload) |
| `draw-progress` | Bidirectional | `{ boardId, path, socketId }` | ส่งเส้นร่างที่กำลังลากอยู่แบบสด |
| `draw-stroke` | Bidirectional | `{ boardId, stroke, socketId }` | บันทึกเส้นถาวรหลังจากยกปากกา |
| `update-element` | Bidirectional | `{ boardId, element }` | แก้ไขคุณสมบัติของ Element ที่มีอยู่ |
| `delete-element` | Bidirectional | `{ boardId, elementId }` | ลบ Element ออกจากกระดาน (Undo/Eraser) |
| `clear-canvas` | Bidirectional | `boardId` | ล้างทุกอย่างบนกระดาน |
| `teacher-clear-room` | Client → Server | `groupName` | ครูสั่งล้างกระดานนักเรียนทุกคนในกลุ่ม |
| `cursor-move` | Bidirectional | `{ boardId, username, x, y, color, role, isTeacher }` | พิกัดเคอร์เซอร์เมาส์/ปากกา |
| `viewport-update` | Bidirectional | `{ boardId, pan, zoom, width, height, role, isPresentationMode }` | พิกัดมุมมองหน้าจอ |
| `join-voice` | Client → Server | `{ boardId, username }` | เข้าร่วมห้องคุยเสียง |
| `leave-voice` | Client → Server | `{ boardId }` | ออกจากห้องคุยเสียง |
| `existing-voice-users` | Server → Client | `[{ socketId, username, isMuted }]` | รายชื่อคนที่อยู่ในห้องเสียงก่อนหน้า |
| `user-joined-voice` | Server → Client | `{ socketId, username }` | มีผู้ใช้ใหม่เข้าห้องเสียง |
| `webrtc-offer` | Bidirectional | `{ targetSocketId, offer, callerUsername }` | WebRTC Signaling Offer |
| `webrtc-answer` | Bidirectional | `{ targetSocketId, answer }` | WebRTC Signaling Answer |
| `webrtc-ice-candidate` | Bidirectional | `{ targetSocketId, candidate }` | WebRTC ICE Candidate |
| `mic-status-changed` | Bidirectional | `{ boardId, isMuted }` | แจ้งสถานะเปิด/ปิดไมค์ |
| `admin-mute-user` | Bidirectional | `{ targetSocketId }` | ครูสั่งปิดไมค์นักเรียน (ครูเท่านั้น) |
| `force-presentation` | Bidirectional | `boolean` | ครูเปิด/ปิดโหมดนำเสนอสด PIP (ส่งเฉพาะนักเรียนกลุ่มเดียวกัน, ครูเท่านั้นส่งได้) |
| `update-elements` | Bidirectional | `{ boardId, elements[] }` | **เพิ่มใหม่** อัปเดต element หลายชิ้นในข้อความเดียว (ใช้เวลาลาก selection / ยางลบ) |
| `board-joined` | Server → Client | `{ boardId }` | **เพิ่มใหม่** ยืนยันว่าเข้าห้องสำเร็จ (ให้ไคลเอนต์รอก่อนส่ง viewport) |
| `join-board-denied` | Server → Client | `{ boardId }` | **เพิ่มใหม่** ไม่มีสิทธิ์เข้ากระดานนี้ |

---

## 13. บทสรุป (Summary)

ระบบ **PPark Tutor Board** ได้รับการพัฒนาและขัดเกลาจนตอบโจทย์การใช้งานสอนสดอย่างสมบูรณ์แบบ ทั้งประสิทธิภาพในการวาดเขียนที่ลื่นไหล, ระบบ Palm Rejection ที่เสถียรบน iPad, ระบบเสียง WebRTC ในตัวที่รองรับ Safari, และระบบจัดการห้องเรียนที่ช่วยให้คุณครูควบคุมการเรียนการสอนได้อย่างมีประสิทธิภาพสูงสุด โค้ดได้รับการปรับปรุงให้มีความกระชับ ปลอดภัย และพร้อมสำหรับการพัฒนาต่อยอดได้อย่างยั่งยืนครับ 🚀
