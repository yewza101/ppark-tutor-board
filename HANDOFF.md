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
* **PDF & Documents:** `pdfjs-dist` (ประมวลผล PDF เวกเตอร์เป็น Canvas), `jspdf` & `html2canvas` (ส่งออกกระดานเป็น PDF/Image)
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
> บัญชี Master Admin ตั้งต้นของระบบคือ `username: adminpark` รหัสผ่าน `adminpark` มีสิทธิ์พิเศษในการลงทะเบียนคุณครูใหม่ และล้างกระดาน/เอกสารทั้งหมดเมื่อจบเทอม

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

---

## 11. คู่มือการติดตั้งและการดีพลอย (Setup & Deployment Guide)

### 11.1 ความต้องการขั้นต่ำของระบบ
* **Node.js:** v18.0.0 หรือใหม่กว่า (แนะนำ Node v20+)
* **Database:** บัญชี Supabase พร้อม PostgreSQL Database และ Storage Bucket ชื่อ `board-assests`

### 11.2 การตั้งค่าตัวแปรสภาพแวดล้อม (Environment Variables)

#### Backend (`/backend/.env`):
```env
PORT=3001
JWT_SECRET=your_super_secret_jwt_key_here
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your_supabase_service_role_or_anon_key
```

#### Frontend (`/frontend/.env` หรือใน `config.js`):
```env
VITE_API_URL=https://your-backend-domain.up.railway.app
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
# ทดสอบความถูกต้องของไวยากรณ์ Backend
node -c backend/server.js
node -c backend/routes/board.js
node -c backend/routes/admin.js

# ทดสอบคอมไพล์ Frontend
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
| `join-board` | Client → Server | `{ boardId, role }` | เข้าร่วมห้องกระดานและบันทึกสิทธิ์ |
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
| `admin-mute-user` | Bidirectional | `{ targetSocketId }` | ครูสั่งปิดไมค์นักเรียน |
| `force-presentation` | Bidirectional | `boolean` | ครูเปิด/ปิดโหมดนำเสนอสด PIP |

---

## 13. บทสรุป (Summary)

ระบบ **PPark Tutor Board** ได้รับการพัฒนาและขัดเกลาจนตอบโจทย์การใช้งานสอนสดอย่างสมบูรณ์แบบ ทั้งประสิทธิภาพในการวาดเขียนที่ลื่นไหล, ระบบ Palm Rejection ที่เสถียรบน iPad, ระบบเสียง WebRTC ในตัวที่รองรับ Safari, และระบบจัดการห้องเรียนที่ช่วยให้คุณครูควบคุมการเรียนการสอนได้อย่างมีประสิทธิภาพสูงสุด โค้ดได้รับการปรับปรุงให้มีความกระชับ ปลอดภัย และพร้อมสำหรับการพัฒนาต่อยอดได้อย่างยั่งยืนครับ 🚀
