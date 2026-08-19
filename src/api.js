// Google Apps Script をバックエンドとして使うための通信レイヤー。

const STORAGE_KEY = "kakeicho_script_url";

export function getScriptUrl() {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setScriptUrl(url) {
  localStorage.setItem(STORAGE_KEY, url.trim());
}

async function get(params) {
  const url = getScriptUrl();
  if (!url) throw new Error("Apps ScriptのURLが設定されていません");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`通信エラー: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

async function post(body) {
  const url = getScriptUrl();
  if (!url) throw new Error("Apps ScriptのURLが設定されていません");
  const res = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`通信エラー: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

export async function fetchAll() {
  return get({ action: "list" }); // -> { entries, recurringRules, asobiBudgets, openingBalance }
}

export async function addEntryApi(entry) {
  return post({ action: "addEntry", entry });
}

export async function removeEntryApi(id) {
  return post({ action: "removeEntry", id });
}

export async function editEntryApi(id, amount) {
  return post({ action: "editEntry", id, amount });
}

export async function bulkRemoveEntriesApi(ids) {
  return post({ action: "bulkRemoveEntries", ids });
}

export async function bulkEditAmountApi(ids, amount) {
  return post({ action: "bulkEditAmount", ids, amount });
}

export async function addRuleApi(rule, entries) {
  return post({ action: "addRule", rule, entries });
}

export async function removeRuleApi(ruleId) {
  return post({ action: "removeRule", ruleId });
}

export async function editRuleApi(ruleId, amount) {
  return post({ action: "editRule", ruleId, amount });
}

export async function setBudgetApi(month, budget) {
  return post({ action: "setBudget", month, budget });
}

export async function setConfigApi(key, value) {
  return post({ action: "setConfig", key, value });
}
