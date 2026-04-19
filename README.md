# Vstream - MERN Music Streaming App

A full-stack music streaming application built with the MERN stack (MongoDB, Express, React, Node.js) and powered by the Jamendo API.

## Features
- **Real-time Search**: Search millions of tracks via Jamendo API.
- **Smart Caching**: Search results are automatically cached in MongoDB using an "upsert" strategy.
- **User Accounts**: JWT-based authentication for secure login and signup.
- **Private Library**: Logged-in users can save tracks to their personal playlists.
- **Persistent Audio Player**: Listen to music uninterrupted while navigating between pages.
- **Modern Dark UI**: A sleek, responsive interface inspired by modern streaming platforms.

## Prerequisites
- Node.js (v16+)
- MongoDB (Running locally or on Atlas)
- Jamendo API Client ID (Get one at [developer.jamendo.com](https://developer.jamendo.com/v3.0))

## Installation

1. **Clone the repository** (or save the files provided).

2. **Install Root Dependencies**:
    npm install

3. **Install Client Dependencies**:
    cd client && npm install && cd ..

4. **Configure Environment Variables**:
   Update the `.env` file in the root directory with your credentials:
    PORT=5000
    MONGODB_URI=mongodb://localhost:27017/musicstream
    JWT_SECRET=your_jwt_secret_key
    JAMENDO_CLIENT_ID=your_jamendo_id

## Running the Application

In the root directory, run:
    npm run dev

This command uses `concurrently` to start both the Express backend (Port 5000) and the React frontend (Port 3000).

## Application Structure

- `server/`: Express backend logic
  - `models/`: Mongoose schemas (User, Song, Playlist)
  - `routes/`: API endpoints for Auth, Search, and Library management
  - `middleware/`: JWT verification
- `client/`: React frontend
  - `src/context/`: Global state management for Authentication and Music playback
  - `src/components/`: Reusable UI components including the persistent `PlayerBar`
  - `src/pages/`: Views for Discovery, Library, and Auth

## Troubleshooting
- **Search not returning results**: Ensure your `JAMENDO_CLIENT_ID` is correct in the `.env` file.
- **Audio not playing**: Jamendo tracks are streamed directly. Some tracks may experience regional restrictions or temporary API downtime.
- **MongoDB connection errors**: Ensure your local MongoDB service is running before starting the server.

