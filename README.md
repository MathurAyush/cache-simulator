# 🧠 Cache Hit or Miss Visualizer Simulator

A visual and interactive simulator to understand how cache memory works in Computer Organization and Architecture (COA).

## 🚀 Overview

The **Cache Hit or Miss Visualizer Simulator** is designed to help students and beginners clearly understand cache memory behavior. It transforms complex theoretical concepts like cache mapping, hits, misses, and replacement policies into an easy-to-understand visual experience.

Instead of just solving numerical problems, this simulator shows **step-by-step execution** of memory accesses and how the cache responds to them.

---

## 🎯 Features

* 🔍 Simulates **Cache Hits and Misses** in real-time
* 🧩 Supports multiple **cache mapping techniques**:

  * Direct Mapping
  * Fully Associative Mapping
  * Set-Associative Mapping
* 🔄 Implements **replacement policies**:

  * FIFO (First In First Out)
  * LRU (Least Recently Used)
* 🧮 Automatic calculation of:

  * Hit Ratio
  * Miss Rate
  * Average Memory Access Time (AMAT)
* 📊 Step-by-step visualization of:

  * Tag, Index, Offset breakdown
  * Cache updates after each access
* ⚙️ Custom configuration:

  * Cache size
  * Block size
  * Associativity

---

## 🧠 Concepts Covered

This project helps in understanding key COA concepts:

* Memory Hierarchy
* Locality of Reference (Temporal & Spatial)
* Cache Mapping Techniques
* Types of Cache Misses:

  * Compulsory
  * Capacity
  * Conflict
* Replacement Policies
* Performance Metrics

---

## 🛠️ Tech Stack

* **Frontend:** HTML, CSS, JavaScript
* **Backend/Logic:** Python (PyQt for GUI) *(if used)*
* **Data Structures:** Arrays, Queues, Linked Lists

---

## ⚙️ How It Works

1. **Configuration**

   * User sets cache parameters (size, block size, etc.)

2. **Address Breakdown**

   * Memory address is split into:

     * Tag
     * Index
     * Offset

3. **Simulation**

   * Cache checks for hit/miss
   * Applies mapping logic
   * Executes replacement policy if needed

4. **Statistics Update**

   * Updates hit/miss count
   * Calculates performance metrics

---

## 📌 Use Cases

* 📚 COA exam preparation
* 👨‍🎓 Learning cache concepts visually
* 🧑‍🏫 Teaching aid for professors
* 💻 Demonstration tool for presentations

---

## 🔮 Future Improvements

* Multi-level cache simulation
* Write policies (Write-Through, Write-Back)
* CPU pipeline integration
* Advanced visualization and animations

---

## 👨‍💻 Author

**Ayush Mathur**
B.Tech CSE | IIIT Vadodara (ICD)

---

## ⭐ Contribution

Feel free to fork this repository, open issues, or submit pull requests to improve the simulator!



