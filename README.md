# 🏭 Satisfactory Balancer Calculator

A robust, interactive load balancer calculator for the game **Satisfactory**.

Unlike standard splitter calculators, this tool not only calculates the exact splitters and mergers needed (using standard 1-to-3 and 3-to-1 mechanics) but also factors in **maximum belt capacities** (Mk.1 through Mk.6). It guarantees that no intermediate belt in the generated graph will ever exceed the maximum transfer rate you have available.

[**🚀 Play with the Live Calculator Here!**](https://justacoasterfan.github.io/satisfactory-balancer/)

## ✨ Features

* **Capacity-Aware Routing:** Select your highest available belt tier (60, 120, 270, 480, 780, or 1200 items/min) to ensure your balancer is actually buildable in-game.

* **Infinite Interactive Canvas:** Pan and zoom around massive factory graphs easily. Click and drag nodes to organize the layout to your liking.

* **Real-Time Collaboration:** Start a shared multiplayer session and send the link to a friend. Structural changes and node movements sync instantly via Firebase.

* **Progress Tracking:** Check off splitters and mergers as you build them in-game. Checked nodes dim themselves and their incoming belts. In multiplayer, it even shows *who* built the node!

* **Visual Clarity:** Splitter outputs are automatically color-coded (Sky, Lime, Pink) so you can easily trace where each fractional branch is going.

## 🛠️ Tech Stack

* **Framework:** React + Vite
* **Styling:** Tailwind CSS v4
* **Icons:** Lucide React
* **Database / Multiplayer:** Firebase Firestore (Realtime Sync)

## 💻 Local Development Setup

If you want to run this project locally on your machine, follow these steps:

1. **Clone the repository:**

   ```bash
   git clone [https://github.com/](https://github.com/)justacoasterfan/satisfactory-balancer.git
   cd satisfactory-balancer
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure Firebase:**
   To use the multiplayer features locally, you need your own Firebase project.

   * Go to the [Firebase Console](https://console.firebase.google.com/) and create a free project.
   * Enable **Firestore** (in Test Mode) and **Authentication** (enable Anonymous sign-in).
   * Get your Web App Config and replace the `firebaseConfig` object at the top of `src/App.jsx`.

4. **Start the development server:**

   ```bash
   npm run dev
   ```

   Open `http://localhost:5173` in your browser.

## 🚀 How to Deploy

This project is configured to deploy easily to **GitHub Pages** using the `gh-pages` npm package.

Whenever you make changes to the code and want to update the live website, simply open your terminal in the project folder and run:

```bash
npm run deploy
```

**What this command does:**

1. It automatically runs `npm run build` (via the `predeploy` script in `package.json`), which bundles the React app and Tailwind CSS into highly optimized static files in the `dist` folder.

2. It pushes the contents of that `dist` folder to a special branch on your repository called `gh-pages`.

3. GitHub automatically sees the update on the `gh-pages` branch and updates your live website within a minute or two.