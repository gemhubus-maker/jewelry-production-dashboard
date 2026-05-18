const STORAGE_KEY = "jewelry-production-orders-v1";
const STATUS_OPTIONS = ["Pending", "In Progress", "Completed", "Hold / Issue"];
const PLACEHOLDER_URL = "PASTE_SUPABASE_PROJECT_URL_HERE";

const supabaseConfig = window.SUPABASE_CONFIG || {};
const liveMode =
  Boolean(window.supabase) &&
  supabaseConfig.url &&
  supabaseConfig.anonKey &&
  supabaseConfig.url !== PLACEHOLDER_URL;
const supabaseClient = liveMode ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey) : null;
const imageBucket = supabaseConfig.imageBucket || "order-images";

let orders = [];
let currentUser = { role: "admin", name: "Demo User", id: null };

const loginScreen = document.querySelector("#loginScreen");
const dashboard = document.querySelector("#dashboard");
const loginForm = document.querySelector("#loginForm");
const roleSelect = document.querySelector("#roleSelect");
const userName = document.querySelector("#userName");
const emailInput = document.querySelector("#emailInput");
const passwordInput = document.querySelector("#passwordInput");
const loginStatus = document.querySelector("#loginStatus");
const activeUser = document.querySelector("#activeUser");
const dashboardTitle = document.querySelector("#dashboardTitle");
const adminTools = document.querySelector("#adminTools");
const roleHelp = document.querySelector("#roleHelp");
const ordersList = document.querySelector("#ordersList");
const orderTemplate = document.querySelector("#orderCardTemplate");
const orderForm = document.querySelector("#orderForm");
const sheetUpload = document.querySelector("#sheetUpload");
const searchInput = document.querySelector("#searchInput");

init();

async function init() {
  if (liveMode) {
    loginStatus.textContent = "Live mode: login with Supabase email and password.";
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    if (session) {
      await openLiveSession(session.user);
      return;
    }
  } else {
    orders = loadDemoOrders();
    seedDemoOrders();
  }
  render();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (liveMode) {
    await loginLive();
    return;
  }

  currentUser = {
    role: roleSelect.value,
    name: userName.value.trim() || "Demo User",
    id: null,
  };
  openDashboard();
  render();
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  if (liveMode) {
    await supabaseClient.auth.signOut();
  }
  dashboard.classList.add("hidden");
  loginScreen.classList.remove("hidden");
});

document.querySelector("#downloadTemplate").addEventListener("click", () => {
  const rows = [
    ["S.No", "Order ID", "SKU", "Stone Weight", "Stone Color", "Stone Shape", "Metal Color", "Item Size"],
    ["1", "ORD-1001", "RING-22K-01", "1.25 ct", "White", "Round", "Gold", "18"],
  ];
  downloadRowsAsExcel(rows, "jewelry-order-template.xls");
});

document.querySelector("#exportVisible").addEventListener("click", () => {
  downloadOrders(filteredOrders(), "jewelry-orders.xls");
});

searchInput.addEventListener("input", renderOrders);

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(orderForm).entries());
  const order = normalizeOrder(data);

  if (liveMode) {
    await insertLiveOrders([order]);
    await loadLiveOrders();
  } else {
    orders.unshift(order);
    saveDemoOrders();
  }

  orderForm.reset();
  render();
});

sheetUpload.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const imported = (await readSheet(file)).map(normalizeOrder);
  if (liveMode) {
    await insertLiveOrders(imported);
    await loadLiveOrders();
  } else {
    orders = [...imported, ...orders];
    saveDemoOrders();
  }

  sheetUpload.value = "";
  render();
});

async function loginLive() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    loginStatus.textContent = "Enter Supabase email and password.";
    return;
  }

  loginStatus.textContent = "Logging in...";
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    loginStatus.textContent = error.message;
    return;
  }

  await openLiveSession(data.user);
}

async function openLiveSession(user) {
  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !profile) {
    profile = await createOwnProfile(user);
  }

  if (error || !profile) {
    currentUser = {
      id: user.id,
      name: user.email || "Live User",
      role: roleSelect.value || "worker",
    };
    loginStatus.innerHTML = `Profile missing for ${escapeHtml(user.email || "this user")}. UID: <code>${escapeHtml(user.id)}</code>`;
    await loadLiveOrders();
    openDashboard();
    render();
    return;
  }

  currentUser = {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
  };
  await loadLiveOrders();
  openDashboard();
  render();
}

async function createOwnProfile(user) {
  const fallbackRole = roleSelect.value === "admin" ? "admin" : "worker";
  const fallbackName = userName.value.trim() || user.email || "Live User";
  const { error: insertError } = await supabaseClient.from("profiles").upsert(
    {
      id: user.id,
      full_name: fallbackName,
      role: fallbackRole,
    },
    { onConflict: "id" }
  );

  if (insertError) return null;

  const { data } = await supabaseClient
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .maybeSingle();
  return data;
}

function openDashboard() {
  loginScreen.classList.add("hidden");
  dashboard.classList.remove("hidden");
}

async function loadLiveOrders() {
  const { data, error } = await supabaseClient
    .from("orders")
    .select("*, order_images(*)")
    .order("created_at", { ascending: false });

  if (error) {
    alert(error.message);
    orders = [];
    return;
  }

  orders = await Promise.all((data || []).map(mapLiveOrder));
}

async function mapLiveOrder(row) {
  const images = [null, null, null];
  await Promise.all(
    (row.order_images || []).map(async (imageRow) => {
      const { data } = await supabaseClient.storage.from(imageBucket).createSignedUrl(imageRow.file_path, 60 * 60);
      images[imageRow.slot - 1] = {
        name: imageRow.file_name,
        path: imageRow.file_path,
        url: data?.signedUrl || "",
      };
    })
  );

  return {
    id: row.id,
    serial: row.serial || "",
    orderId: row.order_id || "",
    sku: row.sku || "",
    stoneWeight: row.stone_weight || "",
    stoneColor: row.stone_color || "",
    stoneShape: row.stone_shape || "",
    metalColor: row.metal_color || "",
    itemSize: row.item_size || "",
    status: row.status || "Pending",
    updatedBy: row.updated_by_name || "-",
    updatedAt: row.updated_at || "",
    images,
  };
}

async function insertLiveOrders(newOrders) {
  const rows = newOrders.map((order) => ({
    serial: order.serial,
    order_id: order.orderId,
    sku: order.sku,
    stone_weight: order.stoneWeight,
    stone_color: order.stoneColor,
    stone_shape: order.stoneShape,
    metal_color: order.metalColor,
    item_size: order.itemSize,
    status: order.status,
    created_by: currentUser.id,
  }));

  const { error } = await supabaseClient.from("orders").insert(rows);
  if (error) alert(error.message);
}

function loadDemoOrders() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveDemoOrders() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

function seedDemoOrders() {
  if (orders.length) return;
  orders = [
    normalizeOrder({
      serial: "1",
      orderId: "ORD-1001",
      sku: "RING-22K-01",
      stoneWeight: "1.25 ct",
      stoneColor: "White",
      stoneShape: "Round",
      metalColor: "Gold",
      itemSize: "18",
    }),
    normalizeOrder({
      serial: "2",
      orderId: "ORD-1002",
      sku: "PEND-18K-08",
      stoneWeight: "0.80 ct",
      stoneColor: "Emerald",
      stoneShape: "Pear",
      metalColor: "Rose Gold",
      itemSize: "Medium",
      status: "In Progress",
    }),
  ];
  saveDemoOrders();
}

function normalizeOrder(data) {
  const images = Array.isArray(data.images) ? data.images.slice(0, 3) : [null, null, null];
  while (images.length < 3) images.push(null);

  return {
    id: data.id || crypto.randomUUID(),
    serial: clean(data.serial || data["S.No"] || data["S No"] || data.sno || data.SNo),
    orderId: clean(data.orderId || data["Order ID"] || data["Order Id"] || data.order_id),
    sku: clean(data.sku || data.SKU || data.Sku),
    stoneWeight: clean(data.stoneWeight || data["Stone Weight"]),
    stoneColor: clean(data.stoneColor || data["Stone Color"]),
    stoneShape: clean(data.stoneShape || data["Stone Shape"]),
    metalColor: clean(data.metalColor || data["Metal Color"]),
    itemSize: clean(data.itemSize || data["Item Size"]),
    status: STATUS_OPTIONS.includes(data.status) ? data.status : data.Status || "Pending",
    updatedBy: data.updatedBy || "-",
    updatedAt: data.updatedAt || "",
    images,
  };
}

function clean(value) {
  return String(value || "").trim();
}

function render() {
  const isAdmin = currentUser.role === "admin";
  activeUser.textContent = `${currentUser.name} - ${isAdmin ? "Admin" : "Worker"}`;
  dashboardTitle.textContent = isAdmin ? "Admin Dashboard" : "Worker Dashboard";
  adminTools.classList.toggle("hidden", !isAdmin);
  roleHelp.textContent = isAdmin
    ? "Manage order details and attach three reference images."
    : "View order details, download files, and update production status.";
  document.body.dataset.role = currentUser.role;
  renderStats();
  renderOrders();
}

function renderStats() {
  document.querySelector("#totalOrders").textContent = orders.length;
  document.querySelector("#pendingOrders").textContent = countStatus("Pending");
  document.querySelector("#progressOrders").textContent = countStatus("In Progress");
  document.querySelector("#completedOrders").textContent = countStatus("Completed");
}

function countStatus(status) {
  return orders.filter((order) => order.status === status).length;
}

function filteredOrders() {
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return orders;
  return orders.filter((order) => `${order.orderId} ${order.sku}`.toLowerCase().includes(query));
}

function renderOrders() {
  ordersList.innerHTML = "";
  const visibleOrders = filteredOrders();

  if (!visibleOrders.length) {
    ordersList.innerHTML = '<div class="empty-state">No orders found.</div>';
    return;
  }

  visibleOrders.forEach((order) => {
    const card = orderTemplate.content.firstElementChild.cloneNode(true);
    setText(card, "serial", order.serial || "-");
    setText(card, "orderId", order.orderId || "No Order ID");
    setText(card, "sku", order.sku || "-");
    setText(card, "stoneWeight", order.stoneWeight || "-");
    setText(card, "stoneColor", order.stoneColor || "-");
    setText(card, "stoneShape", order.stoneShape || "-");
    setText(card, "metalColor", order.metalColor || "-");
    setText(card, "itemSize", order.itemSize || "-");
    setText(card, "updatedBy", order.updatedBy || "-");

    const statusSelect = card.querySelector('[data-action="status"]');
    statusSelect.value = order.status;
    statusSelect.addEventListener("change", () => updateStatus(order.id, statusSelect.value));

    const imageGrid = card.querySelector(".image-grid");
    order.images.forEach((image, index) => imageGrid.appendChild(createImageSlot(order, image, index)));

    card.querySelector('[data-action="downloadOrder"]').addEventListener("click", () => {
      downloadOrders([order], `${order.orderId || "order"}-details.xls`);
    });

    const deleteButton = card.querySelector('[data-action="deleteOrder"]');
    deleteButton.classList.toggle("hidden", currentUser.role !== "admin");
    deleteButton.addEventListener("click", () => deleteOrder(order.id));

    ordersList.appendChild(card);
  });
}

function setText(card, field, value) {
  card.querySelector(`[data-field="${field}"]`).textContent = value;
}

function createImageSlot(order, image, index) {
  const slot = document.createElement("div");
  slot.className = "image-slot";

  const imageSource = image?.url || image?.dataUrl;
  const preview = document.createElement("div");
  preview.className = "image-preview";
  preview.innerHTML = imageSource ? `<img src="${imageSource}" alt="${escapeHtml(image.name)}" />` : `Image ${index + 1}`;

  const buttons = document.createElement("div");
  buttons.className = "image-buttons";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.classList.toggle("hidden", currentUser.role !== "admin");
  input.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await attachImage(order.id, index, file);
  });

  const download = document.createElement("button");
  download.type = "button";
  download.className = "secondary-button";
  download.textContent = "JPG";
  download.disabled = !imageSource;
  download.addEventListener("click", () => downloadImageAsJpg(imageSource, `${order.orderId || "order"}-image-${index + 1}.jpg`));

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "danger-button";
  clear.textContent = "Remove";
  clear.classList.toggle("hidden", currentUser.role !== "admin");
  clear.disabled = !image;
  clear.addEventListener("click", () => removeImage(order.id, index));

  buttons.append(input, download, clear);
  slot.append(preview, buttons);
  return slot;
}

async function attachImage(orderId, index, file) {
  if (liveMode) {
    const slot = index + 1;
    const filePath = `${orderId}/image-${slot}-${Date.now()}-${safeFileName(file.name)}`;
    const { error: uploadError } = await supabaseClient.storage.from(imageBucket).upload(filePath, file, {
      contentType: file.type || "image/jpeg",
      upsert: true,
    });
    if (uploadError) {
      alert(uploadError.message);
      return;
    }

    const { error: rowError } = await supabaseClient.from("order_images").upsert(
      {
        order_id: orderId,
        slot,
        file_path: filePath,
        file_name: file.name,
      },
      { onConflict: "order_id,slot" }
    );
    if (rowError) alert(rowError.message);
    await loadLiveOrders();
    renderOrders();
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  const order = orders.find((item) => item.id === orderId);
  order.images[index] = { name: file.name, type: file.type, dataUrl };
  saveDemoOrders();
  renderOrders();
}

async function removeImage(orderId, index) {
  const order = orders.find((item) => item.id === orderId);
  const image = order?.images[index];

  if (liveMode && image?.path) {
    await supabaseClient.storage.from(imageBucket).remove([image.path]);
    const { error } = await supabaseClient
      .from("order_images")
      .delete()
      .eq("order_id", orderId)
      .eq("slot", index + 1);
    if (error) alert(error.message);
    await loadLiveOrders();
    renderOrders();
    return;
  }

  order.images[index] = null;
  saveDemoOrders();
  renderOrders();
}

async function updateStatus(orderId, status) {
  if (liveMode) {
    const { error } = await supabaseClient
      .from("orders")
      .update({
        status,
        updated_by_name: currentUser.name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    if (error) alert(error.message);
    await loadLiveOrders();
    render();
    return;
  }

  const order = orders.find((item) => item.id === orderId);
  order.status = status;
  order.updatedBy = currentUser.name;
  order.updatedAt = new Date().toLocaleString();
  saveDemoOrders();
  renderStats();
  renderOrders();
}

async function deleteOrder(orderId) {
  if (liveMode) {
    const order = orders.find((item) => item.id === orderId);
    const paths = (order?.images || []).filter(Boolean).map((image) => image.path).filter(Boolean);
    if (paths.length) await supabaseClient.storage.from(imageBucket).remove(paths);
    const { error } = await supabaseClient.from("orders").delete().eq("id", orderId);
    if (error) alert(error.message);
    await loadLiveOrders();
    render();
    return;
  }

  orders = orders.filter((order) => order.id !== orderId);
  saveDemoOrders();
  render();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function readSheet(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "csv") {
    return parseCsv(await file.text());
  }

  if (!window.XLSX) {
    alert("XLSX support needs internet for this page. Please upload CSV or open once with internet.");
    return [];
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(",").map((cell) => cell.trim()));
  const headers = rows.shift() || [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function downloadOrders(selectedOrders, filename) {
  const rows = [
    ["S.No", "Order ID", "SKU", "Stone Weight", "Stone Color", "Stone Shape", "Metal Color", "Item Size", "Status", "Updated By", "Updated Date"],
    ...selectedOrders.map((order) => [
      order.serial,
      order.orderId,
      order.sku,
      order.stoneWeight,
      order.stoneColor,
      order.stoneShape,
      order.metalColor,
      order.itemSize,
      order.status,
      order.updatedBy,
      order.updatedAt,
    ]),
  ];
  downloadRowsAsExcel(rows, filename);
}

function downloadRowsAsExcel(rows, filename) {
  const htmlRows = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<table>${htmlRows}</table>`;
  downloadBlob(new Blob([html], { type: "application/vnd.ms-excel" }), filename);
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadImageAsJpg(imageSource, filename) {
  if (!imageSource) return;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0);
    canvas.toBlob((blob) => downloadBlob(blob, filename), "image/jpeg", 0.92);
  };
  img.src = imageSource;
}

function safeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
