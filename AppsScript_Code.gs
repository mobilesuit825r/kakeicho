/**
 * 家計帳アプリ用 バックエンド (Google Apps Script) - v2
 *
 * セットアップ手順:
 * 1. Google スプレッドシートを新規作成する
 * 2. 拡張機能 > Apps Script を開く
 * 3. このファイルの中身を全部コピーして貼り付ける
 * 4. 上部の関数選択で「setup」を選び、実行ボタン(▶)を押す
 *    (初回は権限の承認画面が出るので許可する)
 * 5. スプレッドシートに「Entries」「Rules」「Budgets」「Config」の4シートができていればOK
 * 6. 右上の「デプロイ」→「新しいデプロイ」
 *    - 種類の選択: ウェブアプリ
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 *    - デプロイ をクリック
 * 7. 表示された「ウェブアプリのURL」をコピーする
 *
 * 注意: 「アクセスできるユーザー: 全員」にすると、
 * このURLを知っている人は誰でもデータを読み書きできます。
 * URLは他人に教えないでください。
 *
 * コードを直した後は「デプロイを管理」→ 鉛筆アイコン →「新しいバージョン」で再デプロイしないと反映されません。
 */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var entries = ss.getSheetByName('Entries') || ss.insertSheet('Entries');
  entries.clear();
  entries.appendRow(['id', 'type', 'date', 'category', 'amount', 'memo', 'isCard', 'cardPayDate', 'planned', 'ruleId']);

  var rules = ss.getSheetByName('Rules') || ss.insertSheet('Rules');
  rules.clear();
  rules.appendRow(['id', 'type', 'category', 'amount', 'startMonth', 'endMonth', 'memo', 'day']);

  var budgets = ss.getSheetByName('Budgets') || ss.insertSheet('Budgets');
  budgets.clear();
  budgets.appendRow(['month', 'budget']);

  var config = ss.getSheetByName('Config') || ss.insertSheet('Config');
  config.clear();
  config.appendRow(['key', 'value']);
  config.appendRow(['openingBalance', 0]);
}

function doGet(e) {
  var action = (e.parameter.action || 'list');
  try {
    if (action === 'list') {
      return respond(getAllData());
    }
    return respond({ error: 'unknown GET action: ' + action });
  } catch (err) {
    return respond({ error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var entriesSheet = ss.getSheetByName('Entries');
    var rulesSheet = ss.getSheetByName('Rules');
    var budgetsSheet = ss.getSheetByName('Budgets');
    var configSheet = ss.getSheetByName('Config');

    if (action === 'addEntry') {
      appendEntry(entriesSheet, body.entry);
      return respond({ status: 'ok' });
    }

    if (action === 'removeEntry') {
      deleteRowsWhere(entriesSheet, 0, body.id);
      return respond({ status: 'ok' });
    }

    if (action === 'editEntry') {
      updateCellWhere(entriesSheet, 0, body.id, 4, body.amount);
      return respond({ status: 'ok' });
    }

    if (action === 'bulkRemoveEntries') {
      var idSet = {};
      body.ids.forEach(function (id) { idSet[id] = true; });
      var data = entriesSheet.getDataRange().getValues();
      for (var i = data.length - 1; i >= 1; i--) {
        if (idSet[data[i][0]]) entriesSheet.deleteRow(i + 1);
      }
      return respond({ status: 'ok' });
    }

    if (action === 'bulkEditAmount') {
      var idSet2 = {};
      body.ids.forEach(function (id) { idSet2[id] = true; });
      var data2 = entriesSheet.getDataRange().getValues();
      for (var j = 1; j < data2.length; j++) {
        if (idSet2[data2[j][0]]) entriesSheet.getRange(j + 1, 5).setValue(body.amount);
      }
      return respond({ status: 'ok' });
    }

    if (action === 'addRule') {
      var rule = body.rule;
      rulesSheet.appendRow([rule.id, rule.type, rule.category, rule.amount, rule.startMonth, rule.endMonth, rule.memo || '', rule.day || '01']);
      (body.entries || []).forEach(function (en) { appendEntry(entriesSheet, en); });
      return respond({ status: 'ok' });
    }

    if (action === 'removeRule') {
      deleteRowsWhere(rulesSheet, 0, body.ruleId);
      var data3 = entriesSheet.getDataRange().getValues();
      for (var k = data3.length - 1; k >= 1; k--) {
        if (data3[k][9] === body.ruleId) entriesSheet.deleteRow(k + 1);
      }
      return respond({ status: 'ok' });
    }

    if (action === 'editRule') {
      updateCellWhere(rulesSheet, 0, body.ruleId, 3, body.amount);
      var data4 = entriesSheet.getDataRange().getValues();
      for (var m = 1; m < data4.length; m++) {
        if (data4[m][9] === body.ruleId) entriesSheet.getRange(m + 1, 5).setValue(body.amount);
      }
      return respond({ status: 'ok' });
    }

    if (action === 'setBudget') {
      var found = false;
      var bData = budgetsSheet.getDataRange().getValues();
      for (var n = 1; n < bData.length; n++) {
        if (String(bData[n][0]) === String(body.month)) {
          budgetsSheet.getRange(n + 1, 2).setValue(body.budget);
          found = true;
          break;
        }
      }
      if (!found) budgetsSheet.appendRow([body.month, body.budget]);
      return respond({ status: 'ok' });
    }

    if (action === 'setConfig') {
      var found2 = false;
      var cData = configSheet.getDataRange().getValues();
      for (var p = 1; p < cData.length; p++) {
        if (String(cData[p][0]) === String(body.key)) {
          configSheet.getRange(p + 1, 2).setValue(body.value);
          found2 = true;
          break;
        }
      }
      if (!found2) configSheet.appendRow([body.key, body.value]);
      return respond({ status: 'ok' });
    }

    return respond({ error: 'unknown POST action: ' + action });
  } catch (err) {
    return respond({ error: String(err) });
  }
}

function appendEntry(sheet, entry) {
  sheet.appendRow([
    entry.id, entry.type, entry.date, entry.category, entry.amount,
    entry.memo || '', entry.isCard ? 1 : 0, entry.cardPayDate || '',
    entry.planned ? 1 : 0, entry.ruleId || ''
  ]);
}

function deleteRowsWhere(sheet, colIndex, value) {
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][colIndex]) === String(value)) sheet.deleteRow(i + 1);
  }
}

function updateCellWhere(sheet, keyColIndex, keyValue, targetColIndex, newValue) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][keyColIndex]) === String(keyValue)) {
      sheet.getRange(i + 1, targetColIndex + 1).setValue(newValue);
      return;
    }
  }
}

function getAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var entriesSheet = ss.getSheetByName('Entries');
  var rulesSheet = ss.getSheetByName('Rules');
  var budgetsSheet = ss.getSheetByName('Budgets');
  var configSheet = ss.getSheetByName('Config');

  var eData = entriesSheet.getDataRange().getValues();
  var entries = [];
  for (var i = 1; i < eData.length; i++) {
    if (!eData[i][0]) continue;
    entries.push({
      id: eData[i][0], type: eData[i][1], date: formatDate(eData[i][2]),
      category: eData[i][3], amount: eData[i][4], memo: eData[i][5],
      isCard: !!eData[i][6], cardPayDate: eData[i][7] ? formatDate(eData[i][7]) : null,
      planned: !!eData[i][8], ruleId: eData[i][9] || null
    });
  }

  var rData = rulesSheet.getDataRange().getValues();
  var rules = [];
  for (var j = 1; j < rData.length; j++) {
    if (!rData[j][0]) continue;
    rules.push({
      id: rData[j][0], type: rData[j][1], category: rData[j][2], amount: rData[j][3],
      startMonth: rData[j][4], endMonth: rData[j][5], memo: rData[j][6], day: rData[j][7]
    });
  }

  var bData = budgetsSheet.getDataRange().getValues();
  var budgets = {};
  for (var k = 1; k < bData.length; k++) {
    if (!bData[k][0]) continue;
    budgets[bData[k][0]] = bData[k][1];
  }

  var cData = configSheet.getDataRange().getValues();
  var config = {};
  for (var m = 1; m < cData.length; m++) {
    if (!cData[m][0]) continue;
    config[cData[m][0]] = cData[m][1];
  }

  return { entries: entries, recurringRules: rules, asobiBudgets: budgets, openingBalance: Number(config.openingBalance || 0) };
}

function formatDate(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return v;
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
