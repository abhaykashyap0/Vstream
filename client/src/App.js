import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { MusicProvider } from './context/MusicContext';
import Navbar from './components/Navbar';
import PlayerBar from './components/PlayerBar';
import HomePage from './pages/HomePage';
import LibraryPage from './pages/LibraryPage';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './App.css';

function App() {
  return (
    // ✅ MusicProvider must be outside AuthProvider
    // so AuthContext can access resetPlayer from MusicContext
    <MusicProvider>
      <AuthProvider>
        <Router>
          <div className="app-container">
            <Navbar />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
            </Routes>
            <PlayerBar />
          </div>
        </Router>
      </AuthProvider>
    </MusicProvider>
  );
}

export default App;


// On logout → stop music, clear player bar
// On login → restore recently played so user sees their history

// Only 2 files need changes — MusicContext.js (add a reset function) and AuthContext.js.app.js
//  (call reset on logout, restore on login):



// import React from 'react';
// import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
// import { AuthProvider } from './context/AuthContext';
// import { MusicProvider } from './context/MusicContext';
// import Navbar from './components/Navbar';
// import PlayerBar from './components/PlayerBar';
// import HomePage from './pages/HomePage';
// import LibraryPage from './pages/LibraryPage';
// import Login from './pages/Login';
// import Signup from './pages/Signup';
// import './App.css';

// // ... existing imports

// function App() {
//   return (
//     <AuthProvider>
//       <MusicProvider>
//         {/* Only ONE Router should exist, and it's right here */}
//         <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
//           <div className="app-container">
//             <Navbar />
//             <Routes>
//               <Route path="/" element={<HomePage />} />
//               <Route path="/library" element={<LibraryPage />} />
//               <Route path="/login" element={<Login />} />
//               <Route path="/signup" element={<Signup />} />
//             </Routes>
//             <PlayerBar />
//           </div>
//         </Router>
//       </MusicProvider>
//     </AuthProvider>
//   );
// }

// export default App;
// function App() {
//   return (
//     <AuthProvider>
//       <MusicProvider>
//         <Router>
//           <div className="app-container">
//             <Navbar />
//             <Routes>
//               <Route path="/" element={<HomePage />} />
//               <Route path="/library" element={<LibraryPage />} />
//               <Route path="/login" element={<Login />} />
//               <Route path="/signup" element={<Signup />} />
//             </Routes>
//             <PlayerBar />
//           </div>
//         </Router>
//       </MusicProvider>
//     </AuthProvider>
//   );
// }


