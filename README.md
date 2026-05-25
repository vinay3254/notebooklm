# NotebookLM Clone (NoteAI) 🎙️🎨

An exact, pixel-perfect, responsive full-stack clone of **Google NotebookLM**. It combines a sleek Material Design 3 warm sage/paper user interface with a full Node.js express backend, document upload parsers, and a conversational dual-host Audio Overview player.

![NotebookLM UI Preview](https://img.shields.io/badge/UI-Material_Design_3-005043)
![License](https://img.shields.io/badge/License-MIT-brightgreen)
![Gemini AI](https://img.shields.io/badge/AI-Gemini_1.5_Flash-blue)

---

## 🌟 Key Features

### 🎨 Pixel-Perfect UI/UX
* **Warm Paper Aesthetic**: Replicates the cozy parchment background (`#fbf9f4`) and sleek pine green headers (`#005043`) of Google's actual NotebookLM.
* **Responsive 3-Panel Workspace**: Manage sources on the left, chat with the AI in the center, and generate podcasts/study guides on the right.
* **Material Design 3 Elements**: Smooth hover micro-animations, clean circular badges, and floating control states.

### 🎙️ AI Podcast (Dual-Host Audio Overview)
* **Alex & Sam Hosts**: Real conversational podcast generated directly from your sources.
* **Conversational Voice Synthesis**: Dynamically switches between male and female en-US voices with custom pitches/rates.
* **Auto-Scrolling Script Viewer**: Follow along with the transcript dynamically as the hosts speak with synchronous highlight states.
* **Audio Interactive Scrubbing**: Jump to any specific sentence in the dialogue timeline instantly.

### 📎 Source Management
* **Multi-Format Uploads**: Support for **PDF documents**, **Website URLs**, **Paste-in Raw Text**, and **YouTube URL transcripts**.
* **Source Citations**: AI responses include inline source citation numbers (e.g. `[1]`, `[2]`) that open the exact source content model when clicked.

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org) (v18 or higher recommended)
* A [Gemini API Key](https://aistudio.google.com/app/apikey) (Free)

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/vinay3254/nlm.git
   cd nlm
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Start the server**:
   ```bash
   npm start
   ```

5. **Open in browser**:
   Visit **[http://localhost:3000](http://localhost:3000)** to explore!

---

## 🛠️ Technology Stack
* **Frontend**: HTML5, CSS3, Vanilla ES6 JavaScript (Google Fonts, MD3 tokens)
* **Backend**: Node.js, Express.js, Multer (file handling)
* **Parsing Engine**: `pdf-parse` (for PDF text extraction), `cheerio` & `axios` (web scraping), `youtube-transcript` (fetching YouTube text transcripts)
* **AI Model**: Google Gemini 1.5 Flash via `@google/generative-ai`

---

## 📝 License
This project is licensed under the MIT License - see the LICENSE file for details.
