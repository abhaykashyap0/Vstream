import React, { useContext, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { Music, LogOut, User as UserIcon, Library, Menu, X } from 'lucide-react';

const Navbar = () => {
  const { user, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
    setMenuOpen(false);
  };

  return (
    <>
      <nav className="nav">
        {/* Logo — same as original */}
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.5rem', marginLeft: 0, color: 'white', textDecoration: 'none', fontWeight: 700 }}>
          <Music color="#1db954" size={32} />
          <span>Vstream</span>
        </Link>

        {/* Desktop links — exactly like original */}
        <div className="nav-links">
          <Link to="/">Search</Link>
          {user ? (
            <>
              <Link to="/library">
                <Library size={18} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                Library
              </Link>
              <span style={{ marginLeft: '20px', color: '#1db954', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <UserIcon size={18} style={{ verticalAlign: 'middle' }} /> {user.username}
              </span>
              <button
                onClick={handleLogout}
                style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginLeft: '20px' }}
              >
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Login</Link>
              <Link to="/signup" className="btn-primary" style={{ marginLeft: '8px' }}>Sign Up</Link>
            </>
          )}
        </div>

        {/* Hamburger — mobile only */}
        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(prev => !prev)}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {/* Mobile menu */}
      <div className={`nav-mobile-menu ${menuOpen ? 'open' : ''}`}>
        <Link to="/" onClick={() => setMenuOpen(false)}>Search</Link>
        {user ? (
          <>
            <Link to="/library" onClick={() => setMenuOpen(false)}>
              <Library size={18} /> Library
            </Link>
            <div style={{ padding: '12px 16px', color: '#1db954', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
              <UserIcon size={18} /> {user.username}
            </div>
            <button onClick={handleLogout} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#b3b3b3', padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: '8px',
              fontWeight: 600, fontSize: '1rem', width: '100%'
            }}>
              <LogOut size={18} /> Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" onClick={() => setMenuOpen(false)}>Login</Link>
            <Link to="/signup" onClick={() => setMenuOpen(false)} style={{ color: '#1db954', fontWeight: 700 }}>Sign Up</Link>
          </>
        )}
      </div>
    </>
  );
};

export default Navbar;


//old nav app and nav




// import React, { useContext, useState } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { AuthContext } from '../context/AuthContext';
// import { Music, LogOut, User as UserIcon, Library, Search, Menu, X } from 'lucide-react';

// const Navbar = () => {
//   const { user, logout } = useContext(AuthContext);
//   const navigate = useNavigate();
//   const [menuOpen, setMenuOpen] = useState(false);

//   const handleLogout = () => {
//     logout();
//     navigate('/login');
//     setMenuOpen(false);
//   };

//   const closeMenu = () => setMenuOpen(false);

//   return (
//     <>
//       <nav className="nav">
//         {/* Logo */}
//         <Link to="/" className="nav-logo" onClick={closeMenu}>
//           <Music color="#1db954" size={28} />
//           <span>JamStream</span>
//         </Link>

//         {/* Desktop links */}
//         <div className="nav-links">
//           <Link to="/"><Search size={16} /> Search</Link>
//           {user ? (
//             <>
//               <Link to="/library"><Library size={16} /> Library</Link>
//               <span className="nav-username">
//                 <UserIcon size={16} /> {user.username}
//               </span>
//               <button
//                 onClick={handleLogout}
//                 style={{
//                   background: 'none', border: 'none',
//                   color: 'var(--text-dim)', cursor: 'pointer',
//                   padding: '8px', borderRadius: '6px',
//                   display: 'flex', alignItems: 'center',
//                   transition: 'color 0.2s'
//                 }}
//                 title="Logout"
//               >
//                 <LogOut size={18} />
//               </button>
//             </>
//           ) : (
//             <>
//               <Link to="/login">Login</Link>
//               <Link to="/signup" className="btn-primary" style={{ marginLeft: '8px' }}>Sign Up</Link>
//             </>
//           )}
//         </div>

//         {/* Mobile hamburger */}
//         {/* <button
//           className="nav-hamburger"
//           onClick={() => setMenuOpen(prev => !prev)}
//           aria-label="Toggle menu"
//         >
//           {menuOpen ? <X size={24} /> : <Menu size={24} />}
//         </button> */}
//       </nav>

//       {/* Mobile dropdown menu */}
//       {/* <div className={`nav-mobile-menu ${menuOpen ? 'open' : ''}`}>
//         <Link to="/" onClick={closeMenu}><Search size={18} /> Search</Link>
//         {user ? (
//           <>
//             <Link to="/library" onClick={closeMenu}><Library size={18} /> Library</Link>
//             <div style={{
//               padding: '12px 16px', color: 'var(--accent)',
//               display: 'flex', alignItems: 'center', gap: '8px',
//               fontWeight: 600
//             }}>
//               <UserIcon size={18} /> {user.username}
//             </div>
//             <button
//               onClick={handleLogout}
//               style={{
//                 background: 'none', border: 'none', cursor: 'pointer',
//                 color: 'var(--text-dim)', padding: '12px 16px',
//                 display: 'flex', alignItems: 'center', gap: '8px',
//                 fontWeight: 600, fontSize: '1rem', width: '100%',
//                 borderRadius: 'var(--radius)'
//               }}
//             >
//               <LogOut size={18} /> Logout
//             </button>
//           </>
//         ) : (
//           <>
//             <Link to="/login" onClick={closeMenu}>Login</Link>
//             <Link to="/signup" onClick={closeMenu} style={{ color: 'var(--accent)' }}>Sign Up</Link>
//           </>
//         )}
//       </div> */}
//     </>
//   );
// };

// export default Navbar;

///*updated app.css,homepage.librarypage,navbar,login page, signin page ,playebar
//for responsiveness*/

// import React, { useContext } from 'react';
// import { Link, useNavigate } from 'react-router-dom';
// import { AuthContext } from '../context/AuthContext';
// import { Music, LogOut, User as UserIcon, Library } from 'lucide-react';

// const Navbar = () => {
//   const { user, logout } = useContext(AuthContext);
//   const navigate = useNavigate();

//   const handleLogout = () => {
//     logout();
//     navigate('/login');
//   };

//   return (
//     <nav className="nav">
//       <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.5rem', marginLeft: 0 }}>
//         <Music color="#1db954" size={32} />
//         <span>JamStream</span>
//       </Link>
//       <div>
//         <Link to="/">Search</Link>
//         {user ? (
//           <>
//             <Link to="/library"><Library size={18} style={{verticalAlign: 'middle', marginRight: '4px'}}/> Library</Link>
//             <span style={{ marginLeft: '20px', color: '#1db954' }}>
//               <UserIcon size={18} style={{verticalAlign: 'middle'}}/> {user.username}
//             </span>
//             <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#b3b3b3', cursor: 'pointer', marginLeft: '20px' }}>
//               <LogOut size={18} />
//             </button>
//           </>
//         ) : (
//           <>
//             <Link to="/login">Login</Link>
//             <Link to="/signup" className="btn-primary">Sign Up</Link>
//           </>
//         )}
//       </div>
//     </nav>
//   );
// };

// export default Navbar;
