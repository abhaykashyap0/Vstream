<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#1db954" />
    <meta name="description" content="VStream - Your personal music streaming app" />

    <!-- PWA meta tags -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="VStream" />
    <meta name="mobile-web-app-capable" content="yes" />

    <link rel="manifest" href="/manifest.json" />
    <title>VStream</title>

    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.getRegistrations().then(function(regs) {
            regs.forEach(function(reg) { reg.unregister(); });
          });
          setTimeout(function() {
            navigator.serviceWorker.register('/serviceWorker.js')
              .then(function() { console.log('SW registered'); })
              .catch(function(err) { console.log('SW failed:', err); });
          }, 1000);
        });
      }
    </script>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>

// import React from 'react'; // Add this line
// import ReactDOM from 'react-dom/client';
// import App from './App';
// import './App.css';

// const rootElement = document.getElementById('root');
// const root = ReactDOM.createRoot(rootElement);

// root.render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>
// );
// import React from 'react';
// import ReactDOM from 'react-dom/client';
// import App from './App';

// This looks specifically for the element with id="root"
// const rootElement = document.getElementById('root');

// if (!rootElement) {
//   throw new Error("Failed to find the root element. Ensure index.html has <div id='root'></div>");
// }

// const root = ReactDOM.createRoot(rootElement);
// root.render(
//   <React.StrictMode>
//     <App />
//   </React.StrictMode>
// );import React from 'react';
