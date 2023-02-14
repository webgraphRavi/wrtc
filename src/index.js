import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import browserDetails from "./js/adapter";
import Widget from "./widget";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";
browserDetails();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <>
    <Router>
      <Routes>
        <Route element={<App />} path="/" />
        <Route element={<Widget />} path="/widget" />
      </Routes>
    </Router>
    {/* <App /> */}
  </>
);
