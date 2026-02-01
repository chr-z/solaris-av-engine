<div align="center">
  <h1>SOLARIS | AV Analysis Engine</h1>
  <p><strong>Production-Grade Technical Monitoring Platform for High-Scale Media Pipelines</strong></p>

  <p>
    <a href="#impact">
      <img src="https://img.shields.io/badge/Efficiency_Gain-650%25-success?style=for-the-badge" alt="Efficiency" />
    </a>
    <a href="#tech-stack">
      <img src="https://img.shields.io/badge/Status-Production_Legacy-blue?style=for-the-badge" alt="Status" />
    </a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Vite-5.0-B73BFE?style=for-the-badge&logo=vite" alt="Vite" />
    <img src="https://img.shields.io/badge/React-18.2-61DAFB?style=for-the-badge&logo=react" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-5.0-007ACC?style=for-the-badge&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Firebase-10.12-FFCA28?style=for-the-badge&logo=firebase" alt="Firebase" />
    <img src="https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white" alt="GCP" />
  </p>
</div>

<br />

## 📋 Project Overview

**Solaris** is a specialized engineering solution designed to automate and streamline the Quality Control (QC) process for high-volume video production environments.

Architected to support a massive EdTech pipeline delivering thousands of hours of content, this engine eliminates manual bottlenecks by providing real-time technical analysis tools (Scopes, Waveforms, Metadata Parsing) directly in the browser, integrated with cloud storage APIs.

> **Note:** This repository contains the source code of the tool currently used in production. Some proprietary API keys and sensitive configuration files have been mocked or removed for security/showcase purposes.

## 🚀 Business Impact & Metrics

Solaris was developed to solve a critical bottleneck in video quality assurance. In a real-world production environment, it achieved:

* **650% Efficiency Gain:** Reduced average video analysis time from **5 minutes to 40 seconds** (per 30min block).
* **Scalability:** Enabled the team to process **2,000+ videos/month** (up from 1,400), even with a 30% reduction in staff availability.
* **Process Automation:** Eliminated 100% of manual spreadsheet data entry by integrating directly with Google Sheets API for logging and reporting.

## 🛠 Engineering & Architecture

### 1. The Core Engine (AV Processing)
The application decouples visualization logic from the React render cycle to ensure high performance (60fps).
* **Canvas API & DSP:** Implements RGB Parades and Luma Waveforms using `willReadFrequently` optimizations.
* **Audio Intelligence:** Utilizes Web Audio API for real-time FFT (Fast Fourier Transform) spectrograms and RMS normalization detection.
* **Data Parsing:** Custom algorithms to parse raw video metadata and binary streams directly in the client.

### 2. Observability & Reliability
* **Black Box Logging:** Includes a custom-built observability module (`src/utils/logCapture.ts`) that intercepts console errors, network failures (400/500), and application state to generate structured bug reports.
* **Resilience:** Implements retry logic for API consumption and robust error handling for external integrations (Google Drive/YouTube).

### 3. Data & Security layer
* **Authentication:** OAuth 2.0 via Google Identity Services (GIS) with role-based access control.
* **Distributed State:** Firebase Realtime Database handles optimistic locking, preventing race conditions when multiple analysts access the same work order.

## 💻 Tech Stack

* **Frontend:** React 18, TypeScript, TailwindCSS
* **Build Tool:** Vite (configured for optimized production builds)
* **Backend/BaaS:** Firebase (Auth, Firestore, Realtime DB)
* **Integrations:** Google Drive API v3, Google Sheets API v4, YouTube Data API
* **Quality:** ESLint, Strict Type Checking

## 📂 Project Structure Snapshot

```bash
src/
├── components/
│   ├── Analysis/       # Data Grids & QC Logic
│   ├── Media/          # Video Player & DSP Visualizers (Scopes)
│   ├── Monitors/       # Canvas implementations (RGB/Waveform)
│   └── ...
├── config/             # Firebase & Environment configurations
├── contexts/           # React Contexts for Global State
├── hooks/              # Custom Hooks (useAVAnalysis, useAuth)
├── services/           # API Integration Layers (Google/Sheets)
├── types/              # TypeScript Definitions (Strict Typing)
└── utils/              # Helper functions & Log Capture
```

## 🏁 Getting Started (Local Development)

To run this project locally for code inspection:

1.  **Clone the repository**
    ```bash
    git clone [https://github.com/chr-z/solaris-av-engine.git](https://github.com/chr-z/solaris-av-engine.git)
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Run Development Server**
    ```bash
    npm run dev
    ```
    *Note: Without valid `.env` keys (not included in repo), the application will run in a limited "Mock/Guest" mode or may show authentication errors.*

---

**Developed by Christian Eliel Barboza Maciel**
*Software Engineer & Data Science Student specializing in High-Performance Web Applications.*
[LinkedIn](https://www.linkedin.com/in/christianmaciel/) | [GitHub](https://github.com/chr-z)
