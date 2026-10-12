import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine
} from "recharts";
import {
  getScriptUrl, setScriptUrl, fetchAll,
  addEntryApi, removeEntryApi, editEntryApi, bulkRemoveEntriesApi, bulkEditAmountApi,
  addRuleApi, removeRuleApi, editRuleApi, setBudgetApi, setConfigApi,
} from "./api.js";

const YEN = (n) => (isFinite(n) ? Math.round(n).toLocaleString("ja-JP") : "0");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (dateStr) => dateStr.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  return `${y}/${Number(m)}`;
};

const EXPENSE_CATS = ["家賃", "食費", "光熱費", "通信費", "遊び代", "交通費", "奨学金", "カード払い", "日用品", "その他"];
const INCOME_CATS = ["給与", "賞与", "その他"];

// ---- credit card cutoff logic ----
// 締め日: 10日 / 支払日: 締め翌月の4日
// 購入日が1〜10日 -> その月10日締め -> 翌月4日払い
// 購入日が11日以降 -> 翌月10日締め -> 翌々月4日払い

function computeCardPaymentDate(purchaseISO) {
  const d = new Date(purchaseISO + "T00:00:00");
  const day = d.getDate();
  let cutoffMonth = d.getMonth(); // 0-indexed
  let cutoffYear = d.getFullYear();
  if (day > 10) {
    cutoffMonth += 1;
  }
  // payment = cutoff month + 1, day 4
  let payMonth = cutoffMonth + 1;
  let payYear = cutoffYear;
  if (payMonth > 11) { payMonth -= 12; payYear += 1; }
  const pay = new Date(payYear, payMonth, 4);
  return pay.toISOString().slice(0, 10);
}

function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function generateRecurringEntries(rule, ruleId) {
  const out = [];
  let cursor = rule.startMonth;
  let guard = 0;
  while (cursor <= rule.endMonth && guard < 600) {
    out.push({
      id: crypto.randomUUID(),
      ruleId,
      type: rule.type,
      date: `${cursor}-${rule.day || "01"}`,
      category: rule.category,
      amount: Number(rule.amount),
      memo: rule.memo || "(定期予定)",
      isCard: false,
      cardPayDate: null,
      planned: true,
    });
    cursor = addMonths(cursor, 1);
    guard++;
  }
  return out;
}


export default function App() {
  const [scriptUrl, setScriptUrlState] = useState(getScriptUrl());
  const [entries, setEntries] = useState([]);
  const [recurringRules, setRecurringRules] = useState([]);
  const [asobiBudgets, setAsobiBudgets] = useState({});
  const [openingBalance, setOpeningBalanceState] = useState(0);
  const [status, setStatus] = useState(scriptUrl ? "loading" : "needs-setup");
  const [errorMsg, setErrorMsg] = useState("");
  const [tab, setTab] = useState("entry");

  const reload = useCallback(async () => {
    if (!getScriptUrl()) { setStatus("needs-setup"); return; }
    setStatus("loading");
    try {
      const data = await fetchAll();
      setEntries(data.entries || []);
      setRecurringRules(data.recurringRules || []);
      setAsobiBudgets(data.asobiBudgets || {});
      setOpeningBalanceState(Number(data.openingBalance || 0));
      setStatus("ready");
    } catch (e) {
      setErrorMsg(String(e.message || e));
      setStatus("error");
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleSaveUrl = async (url) => {
    setScriptUrl(url);
    setScriptUrlState(url);
    await reload();
  };

  const addEntry = useCallback(async (entry) => {
    const withId = { ...entry, id: crypto.randomUUID() };
    setEntries((prev) => [...prev, withId]);
    try { await addEntryApi(withId); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const removeEntry = useCallback(async (id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try { await removeEntryApi(id); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const editEntry = useCallback(async (id, changes) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...changes } : e)));
    try { await editEntryApi(id, changes.amount); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const bulkRemoveEntries = useCallback(async (ids) => {
    const idSet = new Set(ids);
    setEntries((prev) => prev.filter((e) => !idSet.has(e.id)));
    try { await bulkRemoveEntriesApi(ids); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const bulkEditAmount = useCallback(async (ids, amount) => {
    const idSet = new Set(ids);
    setEntries((prev) => prev.map((e) => (idSet.has(e.id) ? { ...e, amount } : e)));
    try { await bulkEditAmountApi(ids, amount); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const addRecurringRule = useCallback(async (rule) => {
    const id = crypto.randomUUID();
    const generated = generateRecurringEntries(rule, id);
    const fullRule = { ...rule, id };
    setRecurringRules((prev) => [...prev, fullRule]);
    setEntries((prev) => [...prev, ...generated]);
    try { await addRuleApi(fullRule, generated); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const removeRecurringRule = useCallback(async (ruleId) => {
    setRecurringRules((prev) => prev.filter((r) => r.id !== ruleId));
    setEntries((prev) => prev.filter((e) => e.ruleId !== ruleId));
    try { await removeRuleApi(ruleId); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const editRecurringRule = useCallback(async (ruleId, newAmount) => {
    setRecurringRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, amount: newAmount } : r)));
    setEntries((prev) => prev.map((e) => (e.ruleId === ruleId ? { ...e, amount: newAmount } : e)));
    try { await editRuleApi(ruleId, newAmount); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const addOneOffPlanned = useCallback(async (entry) => {
    const withId = { ...entry, id: crypto.randomUUID(), planned: true };
    setEntries((prev) => [...prev, withId]);
    try { await addEntryApi(withId); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const setAsobiBudget = useCallback(async (mk, val) => {
    setAsobiBudgets((prev) => ({ ...prev, [mk]: val }));
    try { await setBudgetApi(mk, val); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const setOpeningBalance = useCallback(async (val) => {
    setOpeningBalanceState(val);
    try { await setConfigApi("openingBalance", val); } catch (e) { setErrorMsg(String(e.message || e)); }
  }, []);

  const monthlyTotals = useMemo(() => {
    const map = {};
    for (const e of entries) {
      const mk = monthKey(e.date);
      if (!map[mk]) map[mk] = { income: 0, expense: 0 };
      if (e.type === "income") map[mk].income += Number(e.amount);
      else map[mk].expense += Number(e.amount);
    }
    const keys = Object.keys(map).sort();
    let cum = Number(openingBalance || 0);
    return keys.map((mk) => {
      const net = map[mk].income - map[mk].expense;
      cum += net;
      return { month: mk, label: monthLabel(mk), income: map[mk].income, expense: map[mk].expense, net, cumulative: cum };
    });
  }, [entries, openingBalance]);

  if (status === "needs-setup" || status === "error") {
    return (
      <div style={styles.appRoot}>
        <style>{globalCss}</style>
        <SetupScreen onSave={handleSaveUrl} error={status === "error" ? errorMsg : null} defaultUrl={scriptUrl} />
      </div>
    );
  }

  return (
    <div style={styles.appRoot}>
      <style>{globalCss}</style>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.stamp}>帳</div>
          <div>
            <div style={styles.title}>家計帳</div>
            <div style={styles.subtitle}>
              {status === "loading" ? "読み込み中…" : "Googleスプレッドシートと同期中"}
            </div>
          </div>
          <button style={styles.settingsBtn} onClick={() => setTab("settings")}>設定</button>
        </div>
        <nav style={styles.nav}>
          {[
            ["entry", "収支入力"],
            ["summary", "サマリー"],
            ["asobi", "遊び代"],
            ["simulation", "貯金シミュレーション"],
            ["scenario", "シナリオ比較"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ ...styles.navBtn, ...(tab === id ? styles.navBtnActive : {}) }}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={styles.main}>
        {errorMsg && (
          <div style={styles.errorBanner}>
            通信エラー: {errorMsg} <button style={styles.retryBtn} onClick={reload}>再読み込み</button>
          </div>
        )}
        {tab === "entry" && (
          <EntryTab
            data={{ entries }}
            addEntry={addEntry}
            removeEntry={removeEntry}
            editEntry={editEntry}
            bulkRemoveEntries={bulkRemoveEntries}
            bulkEditAmount={bulkEditAmount}
          />
        )}
        {tab === "summary" && (
          <SummaryTab monthlyTotals={monthlyTotals} openingBalance={openingBalance} setOpeningBalance={setOpeningBalance} />
        )}
        {tab === "asobi" && (
          <AsobiTab entries={entries} asobiBudgets={asobiBudgets} setAsobiBudget={setAsobiBudget} />
        )}
        {tab === "simulation" && (
          <SimulationTab
            monthlyTotals={monthlyTotals}
            recurringRules={recurringRules}
            addRecurringRule={addRecurringRule}
            removeRecurringRule={removeRecurringRule}
            editRecurringRule={editRecurringRule}
            addOneOffPlanned={addOneOffPlanned}
            entries={entries}
            removeEntry={removeEntry}
            editEntry={editEntry}
          />
        )}
        {tab === "scenario" && <ScenarioTab />}
        {tab === "settings" && (
          <SetupScreen onSave={handleSaveUrl} error={null} defaultUrl={scriptUrl} embedded />
        )}
      </main>
    </div>
  );
}

/* ================= SETUP / SETTINGS ================= */
function SetupScreen({ onSave, error, defaultUrl, embedded }) {
  const [url, setUrl] = useState(defaultUrl || "");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave(url);
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 560, margin: embedded ? "0" : "60px auto", padding: 20 }}>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>{embedded ? "設定" : "はじめに: 保存先を設定"}</h2>
        {error && <div style={styles.errorBanner}>{error}</div>}
        <p style={styles.note}>
          Google Apps Script を「ウェブアプリ」としてデプロイしたときに発行される、
          <strong>.../exec</strong> で終わるURLを貼り付けてください。
        </p>
        <form onSubmit={submit} style={styles.form}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            style={styles.input}
          />
          <button type="submit" style={styles.submitBtn} disabled={saving}>
            {saving ? "確認中…" : "保存して接続"}
          </button>
        </form>
      </section>
    </div>
  );
}


/* ================= ENTRY TAB ================= */
function EntryTab({ data, addEntry, removeEntry, editEntry, bulkRemoveEntries, bulkEditAmount }) {
  const [type, setType] = useState("expense");
  const [date, setDate] = useState(todayISO());
  const [category, setCategory] = useState(EXPENSE_CATS[0]);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [isCard, setIsCard] = useState(false);

  const [filterMonth, setFilterMonth] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterText, setFilterText] = useState("");

  const [selected, setSelected] = useState(() => new Set());
  const [bulkAmount, setBulkAmount] = useState("");

  const cats = type === "income" ? INCOME_CATS : EXPENSE_CATS;

  useEffect(() => {
    setCategory(cats[0]);
  }, [type]); // eslint-disable-line

  const submit = (e) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return;
    addEntry({
      type,
      date,
      category,
      amount: Number(amount),
      memo,
      isCard: type === "expense" ? isCard : false,
      cardPayDate: isCard ? computeCardPaymentDate(date) : null,
    });
    setAmount("");
    setMemo("");
  };

  const sorted = [...data.entries].sort((a, b) => (a.date < b.date ? 1 : -1));

  const allCategories = useMemo(
    () => [...new Set(data.entries.map((e) => e.category))].sort(),
    [data.entries]
  );

  const filtered = sorted.filter((e) => {
    if (filterMonth && monthKey(e.date) !== filterMonth) return false;
    if (filterCategory && e.category !== filterCategory) return false;
    if (filterText && !(`${e.category} ${e.memo}`.includes(filterText))) return false;
    return true;
  });

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        filtered.forEach((e) => next.delete(e.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((e) => next.add(e.id));
      return next;
    });
  };
  const selectedCount = [...selected].filter((id) => filtered.some((e) => e.id === id)).length;

  const doBulkDelete = () => {
    const ids = filtered.filter((e) => selected.has(e.id)).map((e) => e.id);
    if (ids.length === 0) return;
    if (!window.confirm(`選択した${ids.length}件を削除します。よろしいですか？`)) return;
    bulkRemoveEntries(ids);
    setSelected(new Set());
  };
  const doBulkEdit = () => {
    const ids = filtered.filter((e) => selected.has(e.id)).map((e) => e.id);
    const n = Number(bulkAmount);
    if (ids.length === 0 || !n || n <= 0) return;
    bulkEditAmount(ids, n);
    setBulkAmount("");
    setSelected(new Set());
  };

  return (
    <div>
      <section style={{ ...styles.card, maxWidth: 420 }}>
        <h2 style={styles.cardTitle}>記帳する</h2>
        <form onSubmit={submit} style={styles.form}>
          <div style={styles.segmented}>
            <button type="button" onClick={() => setType("expense")}
              style={{ ...styles.segBtn, ...(type === "expense" ? styles.segBtnActiveExpense : {}) }}>
              支出
            </button>
            <button type="button" onClick={() => setType("income")}
              style={{ ...styles.segBtn, ...(type === "income" ? styles.segBtnActiveIncome : {}) }}>
              収入
            </button>
          </div>

          <label style={styles.label}>
            日付
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={styles.input} />
          </label>

          <label style={styles.label}>
            カテゴリ
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.input}>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label style={styles.label}>
            金額(円)
            <input type="number" inputMode="numeric" value={amount}
              onChange={(e) => setAmount(e.target.value)} style={styles.input} placeholder="0" />
          </label>

          <label style={styles.label}>
            メモ(任意)
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} style={styles.input} />
          </label>

          {type === "expense" && (
            <label style={styles.checkboxRow}>
              <input type="checkbox" checked={isCard} onChange={(e) => setIsCard(e.target.checked)} />
              クレジットカード払い(10日締め・翌月4日払い)
            </label>
          )}
          {type === "expense" && isCard && (
            <div style={styles.hint}>
              引き落とし予定日: <strong>{computeCardPaymentDate(date)}</strong>
              (遊び代などの月別予算からは<strong>利用日({date})</strong>基準で差し引かれます)
            </div>
          )}

          <button type="submit" style={styles.submitBtn}>記帳する</button>
        </form>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>記帳履歴</h2>
        <div style={styles.filterBar}>
          <label style={{ ...styles.label, maxWidth: 150 }}>月で絞り込み
            <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={styles.input} />
          </label>
          <label style={{ ...styles.label, maxWidth: 160 }}>カテゴリで絞り込み
            <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={styles.input}>
              <option value="">すべて</option>
              {allCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={{ ...styles.label, flex: 1, minWidth: 140 }}>キーワード検索
            <input type="text" value={filterText} onChange={(e) => setFilterText(e.target.value)} style={styles.input} placeholder="メモ・カテゴリ名など" />
          </label>
          {(filterMonth || filterCategory || filterText) && (
            <button
              type="button"
              onClick={() => { setFilterMonth(""); setFilterCategory(""); setFilterText(""); }}
              style={styles.clearFilterBtn}
            >
              絞り込み解除
            </button>
          )}
        </div>

        <div style={styles.selectAllRow}>
          <label style={styles.checkboxRow}>
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} />
            表示中の{filtered.length}件をすべて選択
          </label>
          {selectedCount > 0 && <span style={styles.selectedCountText}>{selectedCount}件選択中</span>}
        </div>

        {selectedCount > 0 && (
          <div style={styles.bulkBar}>
            <button type="button" onClick={doBulkDelete} style={styles.bulkDeleteBtn}>選択した{selectedCount}件を削除</button>
            <div style={styles.bulkEditGroup}>
              <input
                type="number"
                value={bulkAmount}
                onChange={(e) => setBulkAmount(e.target.value)}
                placeholder="変更後の金額"
                style={{ ...styles.input, width: 130 }}
              />
              <button type="button" onClick={doBulkEdit} style={styles.bulkEditBtn}>選択した{selectedCount}件を同じ金額に一括変更</button>
            </div>
          </div>
        )}

        <div style={styles.list}>
          {filtered.length === 0 && <div style={styles.empty}>{sorted.length === 0 ? "まだ記帳がありません。左のフォームから入力してください。" : "条件に一致する記帳がありません。"}</div>}
          {filtered.map((e) => (
            <div key={e.id} style={{ ...styles.listRowSelectable, opacity: e.planned ? 0.6 : 1 }}>
              <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelect(e.id)} />
              <div style={styles.listDate}>{String(e.date).slice(0, 10)}</div>
              <div style={styles.listCat}>{e.category}{e.isCard ? " ・カード" : ""}{e.planned ? " ・予定" : ""}</div>
              <EditableAmount
                value={e.amount}
                sign={e.type === "income" ? "+" : "−"}
                color={e.type === "income" ? "var(--moss)" : "var(--hanko)"}
                onSave={(n) => editEntry(e.id, { amount: n })}
              />
              <button onClick={() => removeEntry(e.id)} style={styles.deleteBtn} aria-label="削除">×</button>
              {e.memo ? <div style={styles.listMemoFull}>💬 {e.memo}</div> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ================= SUMMARY TAB ================= */
function SummaryTab({ monthlyTotals, openingBalance, setOpeningBalance }) {
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  if (monthlyTotals.length === 0) {
    return <div style={styles.card}><div style={styles.empty}>データがまだありません。「収支入力」からはじめてください。</div></div>;
  }

  const displayed = monthlyTotals.filter((m) => {
    if (rangeStart && m.month < rangeStart) return false;
    if (rangeEnd && m.month > rangeEnd) return false;
    return true;
  });
  const latest = displayed.length > 0 ? displayed[displayed.length - 1] : monthlyTotals[monthlyTotals.length - 1];

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>起点残高(2026年7月末時点)</h2>
        <label style={{ ...styles.label, maxWidth: 260 }}>
          2026年8月より前に貯まっていた金額(円)
          <input type="number" value={openingBalance} onChange={(e) => setOpeningBalance(Number(e.target.value))} style={styles.input} />
        </label>
        <p style={styles.note}>2026年8月より前の記帳は入れていないので、その代わりにここで金額を持たせています。以降の累計貯金額はすべてこの金額を起点に計算されます。</p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>表示期間</h2>
        <div style={styles.monthPicker}>
          <label style={{ ...styles.label, maxWidth: 180 }}>開始月
            <input type="month" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} style={styles.input} />
          </label>
          <label style={{ ...styles.label, maxWidth: 180 }}>終了月
            <input type="month" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} style={styles.input} />
          </label>
          {(rangeStart || rangeEnd) && (
            <button type="button" onClick={() => { setRangeStart(""); setRangeEnd(""); }} style={{ ...styles.clearFilterBtn, alignSelf: "flex-end" }}>
              期間指定を解除(全期間表示)
            </button>
          )}
        </div>
      </section>

      <div style={styles.statRow}>
        <StatCard label="累計貯金額" value={`¥${YEN(latest.cumulative)}`} accent="hanko" />
        <StatCard label={`${latest.label}の収支`} value={`${latest.net >= 0 ? "+" : ""}¥${YEN(latest.net)}`} accent={latest.net >= 0 ? "moss" : "hanko"} />
        <StatCard label="記録月数" value={`${displayed.length}ヶ月`} accent="gold" />
      </div>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>累計貯金額の推移</h2>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={displayed} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="var(--inkSoft)" fontSize={12} />
              <YAxis stroke="var(--inkSoft)" fontSize={12} tickFormatter={(v) => `${Math.round(v / 10000)}万`} domain={["auto", "auto"]} />
              <Tooltip formatter={(v) => `¥${YEN(v)}`} contentStyle={styles.tooltip} />
              <ReferenceLine y={0} stroke="var(--inkSoft)" />
              <Line type="monotone" dataKey="cumulative" stroke="var(--hanko)" strokeWidth={2.5} dot={{ r: 3 }} name="累計貯金額" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>月ごとの収入・支出</h2>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={displayed} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="var(--inkSoft)" fontSize={12} />
              <YAxis stroke="var(--inkSoft)" fontSize={12} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => `¥${YEN(v)}`} contentStyle={styles.tooltip} />
              <Legend />
              <Bar dataKey="income" fill="var(--moss)" name="収入" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expense" fill="var(--hanko)" name="支出" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>月次台帳</h2>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>月</th>
                <th style={styles.th}>収入</th>
                <th style={styles.th}>支出</th>
                <th style={styles.th}>収支</th>
                <th style={styles.th}>累計</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((m) => (
                <tr key={m.month}>
                  <td style={styles.td}>{m.label}</td>
                  <td style={styles.td}>¥{YEN(m.income)}</td>
                  <td style={styles.td}>¥{YEN(m.expense)}</td>
                  <td style={{ ...styles.td, color: m.net >= 0 ? "var(--moss)" : "var(--hanko)", fontWeight: 600 }}>
                    {m.net >= 0 ? "+" : ""}¥{YEN(m.net)}
                  </td>
                  <td style={{ ...styles.td, fontWeight: 700 }}>¥{YEN(m.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EditableAmount({ value, color, sign, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{ ...styles.listAmount, color, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline dotted" }}
        title="クリックして金額を編集"
      >
        {sign || ""}{YEN(value)}
      </button>
    );
  }
  const commit = () => {
    const n = Number(draft);
    if (n > 0) onSave(n);
    setEditing(false);
  };
  return (
    <input
      autoFocus
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      style={{ ...styles.input, width: 100, padding: "4px 6px", fontSize: 13 }}
    />
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color: `var(--${accent})` }}>{value}</div>
    </div>
  );
}

/* ================= ASOBI (FUN MONEY) TAB ================= */
function AsobiTab({ entries, asobiBudgets, setAsobiBudget }) {
  const months = useMemo(() => {
    const set = new Set(entries.map((e) => monthKey(e.date)));
    Object.keys(asobiBudgets).forEach((k) => set.add(k));
    set.add(monthKey(todayISO()));
    return [...set].sort();
  }, [entries, asobiBudgets]);

  const [selected, setSelected] = useState(monthKey(todayISO()));
  useEffect(() => { if (!months.includes(selected)) setSelected(months[months.length - 1]); }, [months]); // eslint-disable-line

  const asobiEntries = entries.filter((e) => e.category === "遊び代" && monthKey(e.date) === selected);
  const spent = asobiEntries.reduce((s, e) => s + Number(e.amount), 0);
  const budget = Number(asobiBudgets[selected] || 0);
  const remaining = budget - spent;

  // upcoming card payments (any category, isCard=true), grouped by payment month
  const cardSchedule = useMemo(() => {
    const map = {};
    entries.filter((e) => e.isCard && e.cardPayDate).forEach((e) => {
      const pk = monthKey(e.cardPayDate);
      if (!map[pk]) map[pk] = 0;
      map[pk] += Number(e.amount);
    });
    return Object.keys(map).sort().map((k) => ({ month: k, total: map[k] }));
  }, [entries]);

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>今月の遊び代予算</h2>
        <div style={styles.monthPicker}>
          <label style={{ ...styles.label, maxWidth: 220 }}>
            対象月
            <select value={selected} onChange={(e) => setSelected(e.target.value)} style={styles.input}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <label style={{ ...styles.label, maxWidth: 220 }}>
            予算(円)
            <input type="number" value={asobiBudgets[selected] ?? ""} placeholder="例: 70000"
              onChange={(e) => setAsobiBudget(selected, Number(e.target.value))} style={styles.input} />
          </label>
        </div>

        <div style={styles.statRow}>
          <StatCard label="予算" value={`¥${YEN(budget)}`} accent="gold" />
          <StatCard label="使った額(利用日ベース)" value={`¥${YEN(spent)}`} accent="hanko" />
          <StatCard label="残り" value={`${remaining >= 0 ? "" : "−"}¥${YEN(Math.abs(remaining))}`} accent={remaining >= 0 ? "moss" : "hanko"} />
        </div>

        <div style={styles.list}>
          {asobiEntries.length === 0 && <div style={styles.empty}>この月の遊び代の記録はまだありません。</div>}
          {asobiEntries.map((e) => (
            <div key={e.id} style={styles.listRow}>
              <div style={styles.listDate}>{String(e.date).slice(0, 10)}</div>
              <div style={styles.listMemo}>{e.memo || "(メモなし)"}{e.isCard ? ` ・カード(引落 ${String(e.cardPayDate || "").slice(0, 10)})` : " ・現金"}</div>
              <div style={{ ...styles.listAmount, color: "var(--hanko)" }}>−{YEN(e.amount)}</div>
            </div>
          ))}
        </div>

        <p style={styles.note}>
          遊び代は<strong>使った日(利用日)</strong>基準でその月の予算から差し引かれます。
          クレジットカード払いにチェックを入れた分は、実際の口座からの引き落としが1〜2ヶ月後になりますが、
          予算管理上は前倒しで「使った月」に計上する形にしています。下の「カード引き落とし予定」で、
          実際にいつ・いくら口座から引かれるかを別途確認できます。
        </p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>カード引き落とし予定(実際の口座負担)</h2>
        {cardSchedule.length === 0 ? (
          <div style={styles.empty}>カード払いの記録がまだありません。</div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead><tr><th style={styles.th}>引き落とし月</th><th style={styles.th}>合計金額</th></tr></thead>
              <tbody>
                {cardSchedule.map((c) => (
                  <tr key={c.month}>
                    <td style={styles.td}>{monthLabel(c.month)}</td>
                    <td style={{ ...styles.td, fontWeight: 700 }}>¥{YEN(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= SIMULATION TAB ================= */
function SimulationTab({
  monthlyTotals,
  recurringRules, addRecurringRule, removeRecurringRule, editRecurringRule,
  addOneOffPlanned, entries, removeEntry, editEntry,
}) {
  const [rType, setRType] = useState("expense");
  const [rCategory, setRCategory] = useState(EXPENSE_CATS[0]);
  const [rAmount, setRAmount] = useState("");
  const [rStart, setRStart] = useState(monthKey(todayISO()));
  const [rEnd, setREnd] = useState(addMonths(monthKey(todayISO()), 23));
  const [rMemo, setRMemo] = useState("");

  const [oDate, setODate] = useState(todayISO());
  const [oType, setOType] = useState("expense");
  const [oCategory, setOCategory] = useState("その他");
  const [oAmount, setOAmount] = useState("");
  const [oMemo, setOMemo] = useState("");

  const submitRule = (e) => {
    e.preventDefault();
    if (!rAmount || Number(rAmount) <= 0) return;
    addRecurringRule({
      type: rType, category: rCategory, amount: Number(rAmount),
      startMonth: rStart, endMonth: rEnd, memo: rMemo, day: "01",
    });
    setRAmount(""); setRMemo("");
  };

  const submitOneOff = (e) => {
    e.preventDefault();
    if (!oAmount || Number(oAmount) <= 0) return;
    addOneOffPlanned({ type: oType, date: oDate, category: oCategory, amount: Number(oAmount), memo: oMemo, isCard: false, cardPayDate: null });
    setOAmount(""); setOMemo("");
  };

  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const finalRow = monthlyTotals[monthlyTotals.length - 1];
  const displayed = monthlyTotals.filter((m) => {
    if (rangeStart && m.month < rangeStart) return false;
    if (rangeEnd && m.month > rangeEnd) return false;
    return true;
  });
  const displayedFinal = displayed.length > 0 ? displayed[displayed.length - 1] : finalRow;

  const plannedOneOffs = entries.filter((e) => e.planned && !e.ruleId);

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>貯金シミュレーション結果</h2>
        <p style={styles.note}>
          2026年8月〜の実際の記帳(収支入力タブの内容)に、下で追加する「予定」を足し合わせた、貯金累計の見込みです。
        </p>
        <div style={styles.monthPicker}>
          <label style={{ ...styles.label, maxWidth: 180 }}>開始月
            <input type="month" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} style={styles.input} />
          </label>
          <label style={{ ...styles.label, maxWidth: 180 }}>終了月
            <input type="month" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} style={styles.input} />
          </label>
          {(rangeStart || rangeEnd) && (
            <button type="button" onClick={() => { setRangeStart(""); setRangeEnd(""); }} style={{ ...styles.clearFilterBtn, alignSelf: "flex-end" }}>
              期間指定を解除(全期間表示)
            </button>
          )}
        </div>
        {displayedFinal && (
          <div style={styles.statRow}>
            <StatCard label={`${displayedFinal.label}時点の予想貯金額`} value={`¥${YEN(displayedFinal.cumulative)}`} accent="hanko" />
            <StatCard label="表示中の月数" value={`${displayed.length}ヶ月`} accent="moss" />
          </div>
        )}
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={displayed} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" />
              <XAxis dataKey="label" stroke="var(--inkSoft)" fontSize={11} />
              <YAxis stroke="var(--inkSoft)" fontSize={12} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => `¥${YEN(v)}`} contentStyle={styles.tooltip} />
              <ReferenceLine y={0} stroke="var(--inkSoft)" />
              <Line type="monotone" dataKey="cumulative" stroke="var(--hanko)" strokeWidth={2.5} dot={false} name="予想貯金累計" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid2">
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>定期的な予定を追加</h2>
          <form onSubmit={submitRule} style={styles.form}>
            <div style={styles.segmented}>
              <button type="button" onClick={() => setRType("expense")} style={{ ...styles.segBtn, ...(rType === "expense" ? styles.segBtnActiveExpense : {}) }}>支出</button>
              <button type="button" onClick={() => setRType("income")} style={{ ...styles.segBtn, ...(rType === "income" ? styles.segBtnActiveIncome : {}) }}>収入</button>
            </div>
            <label style={styles.label}>カテゴリ
              <select value={rCategory} onChange={(e) => setRCategory(e.target.value)} style={styles.input}>
                {(rType === "income" ? INCOME_CATS : EXPENSE_CATS).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={styles.label}>毎月の金額(円)
              <input type="number" value={rAmount} onChange={(e) => setRAmount(e.target.value)} style={styles.input} placeholder="例: 67000" />
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <label style={styles.label}>開始月
                <input type="month" value={rStart} onChange={(e) => setRStart(e.target.value)} style={styles.input} />
              </label>
              <label style={styles.label}>終了月
                <input type="month" value={rEnd} onChange={(e) => setREnd(e.target.value)} style={styles.input} />
              </label>
            </div>
            <label style={styles.label}>メモ(任意)
              <input type="text" value={rMemo} onChange={(e) => setRMemo(e.target.value)} style={styles.input} />
            </label>
            <button type="submit" style={styles.submitBtn}>この期間ぶん一括で予定に追加</button>
          </form>

          <h3 style={{ ...styles.cardTitle, fontSize: 14, marginTop: 20 }}>登録済みの定期予定</h3>
          <div style={styles.list}>
            {recurringRules.length === 0 && <div style={styles.empty}>まだありません。</div>}
            {recurringRules.map((r) => (
              <div key={r.id} style={styles.listRow}>
                <div style={styles.listCat}>{r.category}</div>
                <div style={styles.listMemo}>{monthLabel(r.startMonth)}〜{monthLabel(r.endMonth)}</div>
                <EditableAmount
                  value={r.amount}
                  sign={r.type === "income" ? "+" : "−"}
                  color={r.type === "income" ? "var(--moss)" : "var(--hanko)"}
                  onSave={(n) => editRecurringRule(r.id, n)}
                />
                <button onClick={() => removeRecurringRule(r.id)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>単発の予定を追加</h2>
          <form onSubmit={submitOneOff} style={styles.form}>
            <div style={styles.segmented}>
              <button type="button" onClick={() => setOType("expense")} style={{ ...styles.segBtn, ...(oType === "expense" ? styles.segBtnActiveExpense : {}) }}>支出</button>
              <button type="button" onClick={() => setOType("income")} style={{ ...styles.segBtn, ...(oType === "income" ? styles.segBtnActiveIncome : {}) }}>収入</button>
            </div>
            <label style={styles.label}>予定日
              <input type="date" value={oDate} onChange={(e) => setODate(e.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>カテゴリ
              <select value={oCategory} onChange={(e) => setOCategory(e.target.value)} style={styles.input}>
                {(oType === "income" ? INCOME_CATS : EXPENSE_CATS).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={styles.label}>金額(円)
              <input type="number" value={oAmount} onChange={(e) => setOAmount(e.target.value)} style={styles.input} placeholder="例: 651770" />
            </label>
            <label style={styles.label}>メモ(任意)
              <input type="text" value={oMemo} onChange={(e) => setOMemo(e.target.value)} style={styles.input} placeholder="例: ローン一括返済" />
            </label>
            <button type="submit" style={styles.submitBtn}>予定に追加</button>
          </form>

          <h3 style={{ ...styles.cardTitle, fontSize: 14, marginTop: 20 }}>登録済みの単発予定</h3>
          <div style={styles.list}>
            {plannedOneOffs.length === 0 && <div style={styles.empty}>まだありません。</div>}
            {plannedOneOffs.sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => (
              <div key={e.id} style={styles.listRow}>
                <div style={styles.listDate}>{String(e.date).slice(0, 10)}</div>
                <div style={styles.listMemo}>{e.category} {e.memo}</div>
                <EditableAmount
                  value={e.amount}
                  sign={e.type === "income" ? "+" : "−"}
                  color={e.type === "income" ? "var(--moss)" : "var(--hanko)"}
                  onSave={(n) => editEntry(e.id, { amount: n })}
                />
                <button onClick={() => removeEntry(e.id)} style={styles.deleteBtn}>×</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ================= SCENARIO TAB ================= */
function monthlyNet(gross, baseEquiv, opts) {
  const health = Math.round(gross * opts.healthRate);
  const pension = Math.round(gross * opts.pensionRate);
  const employment = Math.round(gross * opts.employmentRate);
  const union = Math.round(Math.min(baseEquiv * 0.015, opts.unionCap));
  const taxable = gross - health - pension - employment;
  const incomeTax = Math.round(taxable * opts.taxRate);
  return gross - health - pension - employment - union - incomeTax - opts.residentTax;
}

function otPay(base, hours) {
  const hourly = Math.ceil((base / 162) * 1.25);
  return hourly * hours;
}

function ScenarioTab() {
  const [base, setBase] = useState(270000);
  const [hours, setHours] = useState(20);
  const [raise1, setRaise1] = useState(5);
  const [raise2, setRaise2] = useState(5);
  const [raise3, setRaise3] = useState(5);
  const [bonusMonths, setBonusMonths] = useState(4);
  const [years, setYears] = useState(3);

  const opts = { healthRate: 0.04925, pensionRate: 0.0915, employmentRate: 0.005, unionCap: 3500, taxRate: 0.025, residentTax: 18000 };

  const projection = useMemo(() => {
    const raises = [raise1, raise2, raise3];
    let currentBase = base;
    const rows = [];
    for (let y = 0; y < years; y++) {
      if (y > 0) currentBase = Math.round(currentBase * (1 + (raises[y - 1] || 0) / 100));
      const gross = currentBase + otPay(currentBase, hours);
      const net = monthlyNet(gross, currentBase, opts);
      const bonusGrossEach = Math.round((currentBase * bonusMonths) / 2);
      const bonusNetEach = Math.round(bonusGrossEach * 0.786); // approx net ratio for bonus
      const annualGross = gross * 12 + bonusGrossEach * 2;
      const annualNet = net * 12 + bonusNetEach * 2;
      rows.push({ year: `${y + 1}年目`, base: currentBase, monthlyGross: gross, monthlyNet: net, annualGross, annualNet });
    }
    return rows;
  }, [base, hours, raise1, raise2, raise3, bonusMonths, years]);

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>条件を入力</h2>
        <div className="grid3">
          <label style={styles.label}>基本給(円)
            <input type="number" value={base} onChange={(e) => setBase(Number(e.target.value))} style={styles.input} />
          </label>
          <label style={styles.label}>残業時間(h/月)
            <input type="number" value={hours} onChange={(e) => setHours(Number(e.target.value))} style={styles.input} />
          </label>
          <label style={styles.label}>賞与(年間合計ヶ月分)
            <input type="number" step="0.1" value={bonusMonths} onChange={(e) => setBonusMonths(Number(e.target.value))} style={styles.input} />
          </label>
          <label style={styles.label}>1年目→2年目 昇給率(%)
            <input type="number" value={raise1} onChange={(e) => setRaise1(Number(e.target.value))} style={styles.input} />
          </label>
          <label style={styles.label}>2年目→3年目 昇給率(%)
            <input type="number" value={raise2} onChange={(e) => setRaise2(Number(e.target.value))} style={styles.input} />
          </label>
          <label style={styles.label}>3年目→4年目 昇給率(%)
            <input type="number" value={raise3} onChange={(e) => setRaise3(Number(e.target.value))} style={styles.input} />
          </label>
          <label style={styles.label}>試算する年数
            <input type="number" min="1" max="4" value={years} onChange={(e) => setYears(Math.max(1, Math.min(4, Number(e.target.value))))} style={styles.input} />
          </label>
        </div>
        <p style={styles.note}>
          手取りは健康保険4.925%・厚生年金9.15%・雇用保険0.5%・住民税(概算18,000円/月)などから逆算した概算値です。実際の金額とは差が出ることがあります。
        </p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>年ごとの見込み</h2>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={projection} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="var(--inkSoft)" fontSize={12} />
              <YAxis stroke="var(--inkSoft)" fontSize={12} tickFormatter={(v) => `${Math.round(v / 10000)}万`} />
              <Tooltip formatter={(v) => `¥${YEN(v)}`} contentStyle={styles.tooltip} />
              <Legend />
              <Bar dataKey="annualGross" fill="var(--gold)" name="額面年収" radius={[3, 3, 0, 0]} />
              <Bar dataKey="annualNet" fill="var(--hanko)" name="手取り年収" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>詳細</h2>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>年目</th><th style={styles.th}>基本給</th>
                <th style={styles.th}>月額面</th><th style={styles.th}>月手取り</th>
                <th style={styles.th}>額面年収</th><th style={styles.th}>手取り年収</th>
              </tr>
            </thead>
            <tbody>
              {projection.map((r) => (
                <tr key={r.year}>
                  <td style={styles.td}>{r.year}</td>
                  <td style={styles.td}>¥{YEN(r.base)}</td>
                  <td style={styles.td}>¥{YEN(r.monthlyGross)}</td>
                  <td style={styles.td}>¥{YEN(r.monthlyNet)}</td>
                  <td style={styles.td}>¥{YEN(r.annualGross)}</td>
                  <td style={{ ...styles.td, fontWeight: 700 }}>¥{YEN(r.annualNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ================= styles ================= */
const globalCss = `
  :root {
    --paper: #F1EDE1;
    --paper2: #E9E3D2;
    --ink: #23283A;
    --inkSoft: #5B6178;
    --hanko: #B4342A;
    --moss: #4B6455;
    --gold: #A67C2E;
    --rule: #D9C9A8;
  }
  html, body { margin: 0; padding: 0; max-width: 100vw; overflow-x: hidden; }
  #root { max-width: 100vw; overflow-x: hidden; }
  * { box-sizing: border-box; }
  input, select, button { font-family: inherit; }
  input:focus, select:focus, button:focus-visible {
    outline: 2px solid var(--hanko); outline-offset: 2px;
  }
  .grid2 { display: grid; grid-template-columns: minmax(260px, 380px) 1fr; gap: 20px; }
  .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
  @media (max-width: 720px) {
    .grid2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 480px) {
    .grid3 { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

const styles = {
  settingsBtn: { marginLeft: "auto", background: "transparent", border: "1px solid var(--rule)", borderRadius: 4, padding: "6px 12px", fontSize: 12.5, color: "var(--inkSoft)", cursor: "pointer", fontWeight: 600 },
  errorBanner: { background: "#F6E3E0", border: "1px solid var(--hanko)", color: "var(--hanko)", padding: "10px 14px", borderRadius: 4, fontSize: 13, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 },
  retryBtn: { background: "var(--hanko)", color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer" },
  appRoot: {
    fontFamily: "'Zen Kaku Gothic New','Hiragino Kaku Gothic ProN',sans-serif",
    background: "var(--paper)",
    color: "var(--ink)",
    minHeight: "100%",
    maxWidth: "100vw",
    overflowX: "hidden",
    padding: "0 0 40px",
  },
  header: {
    borderBottom: "2px solid var(--ink)",
    padding: "20px 20px 0",
    background: "var(--paper)",
    position: "sticky", top: 0, zIndex: 10,
  },
  headerInner: { display: "flex", alignItems: "center", gap: 14, marginBottom: 14 },
  stamp: {
    width: 44, height: 44, borderRadius: "50%", border: "2.5px solid var(--hanko)",
    color: "var(--hanko)", display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "'Shippori Mincho',serif", fontSize: 22, fontWeight: 700, flexShrink: 0,
  },
  title: { fontFamily: "'Shippori Mincho',serif", fontSize: 26, fontWeight: 700, letterSpacing: "0.05em" },
  subtitle: { fontSize: 12.5, color: "var(--inkSoft)", marginTop: 2 },
  nav: { display: "flex", gap: 4, overflowX: "auto" },
  navBtn: {
    background: "transparent", border: "none", borderBottom: "3px solid transparent",
    padding: "10px 14px", fontSize: 14, color: "var(--inkSoft)", cursor: "pointer",
    whiteSpace: "nowrap", fontWeight: 600,
  },
  navBtnActive: { color: "var(--ink)", borderBottom: "3px solid var(--hanko)" },
  main: { maxWidth: 1000, margin: "0 auto", padding: "20px 20px 0" },
  grid2: { display: "grid", gridTemplateColumns: "minmax(260px, 380px) 1fr", gap: 20 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14 },
  card: {
    background: "#FBF9F3", border: "1px solid var(--rule)", borderRadius: 6,
    padding: 20, marginBottom: 20, boxShadow: "0 1px 0 var(--rule)",
  },
  cardTitle: {
    fontFamily: "'Shippori Mincho',serif", fontSize: 17, fontWeight: 700,
    marginBottom: 16, paddingBottom: 8, borderBottom: "1px solid var(--rule)",
  },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  segmented: { display: "flex", border: "1px solid var(--ink)", borderRadius: 4, overflow: "hidden" },
  segBtn: { flex: 1, padding: "8px 0", border: "none", background: "transparent", cursor: "pointer", fontWeight: 700, fontSize: 14, color: "var(--inkSoft)" },
  segBtnActiveExpense: { background: "var(--hanko)", color: "#fff" },
  segBtnActiveIncome: { background: "var(--moss)", color: "#fff" },
  label: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--inkSoft)", fontWeight: 600 },
  input: {
    padding: "9px 10px", border: "1px solid var(--rule)", borderRadius: 4,
    background: "#fff", color: "var(--ink)", fontSize: 14,
  },
  checkboxRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--inkSoft)" },
  hint: { fontSize: 12.5, background: "var(--paper2)", padding: "8px 10px", borderRadius: 4, color: "var(--inkSoft)" },
  submitBtn: {
    marginTop: 6, padding: "11px 0", background: "var(--ink)", color: "#fff",
    border: "none", borderRadius: 4, fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
  list: { display: "flex", flexDirection: "column", gap: 2, maxHeight: 480, overflowY: "auto" },
  listRow: {
    display: "grid", gridTemplateColumns: "90px 100px 1fr auto auto", gap: 10, alignItems: "center",
    padding: "9px 4px", borderBottom: "1px solid var(--rule)", fontSize: 13.5,
  },
  listDate: { color: "var(--inkSoft)", fontVariantNumeric: "tabular-nums" },
  listCat: { fontWeight: 600 },
  listMemo: { color: "var(--inkSoft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  listAmount: { fontWeight: 700, fontVariantNumeric: "tabular-nums", fontFamily: "'Roboto Mono',monospace" },
  deleteBtn: { background: "transparent", border: "none", color: "var(--inkSoft)", cursor: "pointer", fontSize: 16, lineHeight: 1 },
  empty: { color: "var(--inkSoft)", fontSize: 13.5, padding: "20px 0", textAlign: "center" },
  statRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14, marginBottom: 20 },
  statCard: {
    background: "#FBF9F3", border: "1px solid var(--rule)", borderRadius: 6, padding: "16px 18px",
  },
  statLabel: { fontSize: 12, color: "var(--inkSoft)", marginBottom: 6, fontWeight: 600 },
  statValue: { fontSize: 24, fontWeight: 700, fontFamily: "'Roboto Mono',monospace" },
  tooltip: { background: "#FBF9F3", border: "1px solid var(--rule)", fontSize: 13 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13.5 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "2px solid var(--ink)", color: "var(--inkSoft)", fontWeight: 700 },
  td: { padding: "8px 10px", borderBottom: "1px solid var(--rule)", fontVariantNumeric: "tabular-nums" },
  monthPicker: { display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" },
  filterBar: { display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end", paddingBottom: 14, borderBottom: "1px dashed var(--rule)" },
  clearFilterBtn: { background: "transparent", border: "1px solid var(--rule)", borderRadius: 4, padding: "9px 12px", fontSize: 12.5, color: "var(--inkSoft)", cursor: "pointer", fontWeight: 600, height: 38 },
  selectAllRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: 13 },
  selectedCountText: { fontSize: 12.5, color: "var(--hanko)", fontWeight: 700 },
  bulkBar: {
    display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
    background: "var(--paper2)", border: "1px solid var(--rule)", borderRadius: 4,
    padding: "10px 12px", marginBottom: 12,
  },
  bulkDeleteBtn: { background: "var(--hanko)", color: "#fff", border: "none", borderRadius: 4, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  bulkEditGroup: { display: "flex", gap: 8, alignItems: "center" },
  bulkEditBtn: { background: "var(--ink)", color: "#fff", border: "none", borderRadius: 4, padding: "8px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  listRowSelectable: {
    display: "grid", gridTemplateColumns: "20px 90px minmax(0, 1fr) auto auto", gap: "4px 10px", alignItems: "center",
    padding: "9px 4px", borderBottom: "1px solid var(--rule)", fontSize: 13.5,
  },
  listMemoFull: {
    gridColumn: "2 / -1", color: "var(--inkSoft)", fontSize: 12.5, lineHeight: 1.5,
    whiteSpace: "pre-wrap", overflowWrap: "anywhere",
  },
  note: { fontSize: 12.5, color: "var(--inkSoft)", marginTop: 14, lineHeight: 1.6 },
};
