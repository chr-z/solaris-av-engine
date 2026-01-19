<div align="center">
  <h1>SOLARIS | AV Analysis Engine</h1>
  <p><strong>Production-Grade Technical Monitoring Platform for High-Scale Media Pipelines</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Vite-5.0-B73BFE?style=for-the-badge&logo=vite" alt="Vite" />
    <img src="https://img.shields.io/badge/React-18.2-61DAFB?style=for-the-badge&logo=react" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-5.0-007ACC?style=for-the-badge&logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/GCP-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white" alt="GCP" />
    <img src="https://img.shields.io/badge/Firebase-10.12-FFCA28?style=for-the-badge&logo=firebase" alt="Firebase" />
  </p>
</div>

## Project Overview

Solaris is a specialized engineering solution designed to automate and streamline the Quality Control (QC) process for high-volume video production environments. 

Originally architected to support a massive EdTech pipeline delivering thousands of hours of content monthly, this engine eliminates manual bottlenecks by providing real-time technical analysis tools directly in the browser.

### Key Engineering Features

* **Browser-Based DSP:** Implements RGB scopes, Luma waveforms, and Vector scopes using the Canvas API with `willReadFrequently` optimizations for 60fps performance without WebGL overhead.
* **Audio Intelligence:** Uses Web Audio API for real-time Fast Fourier Transform (FFT) spectrograms and RMS volume normalization detection.
* **Secure Stream Proxying:** Features a custom Node.js middleware layer (Serverless Functions) to handle Google Drive and YouTube streams, bypassing CORS restrictions and enabling byte-range seeking.
* **Distributed State:** Leverages Firebase Realtime Database to handle optimistic locking for concurrent editing and "presence" awareness for remote analyst teams.

## Architecture Highlights

### 1. The Core Engine
The application decouples the visualization logic from the React render cycle. By using a custom hook architecture (`useAVAnalysis`), the heavy lifting of pixel manipulation is offloaded to efficient animation frames, ensuring the UI remains responsive even during 4K playback analysis.

### 2. Infrastructure & Security
* **Authentication:** OAuth 2.0 via Google Identity Services (GIS).
* **Data Layer:** Google Sheets API v4 integration acting as a dynamic CMS for work order management.
* **Role-Based Access:** Strict security rules validating user domains and permissions at the database level.

## Getting Started

1.  **Clone the repository**
2.  **Install dependencies:** `npm install`
3.  **Environment Setup:** Configure `.env` with your Firebase and Google Cloud Platform credentials.
4.  **Run Development Server:** `npm run dev`

---

**Developed by Christian Eliel**
*Software Engineer specializing in High-Performance Web Applications and Media Technology.*