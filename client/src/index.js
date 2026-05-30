import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

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
