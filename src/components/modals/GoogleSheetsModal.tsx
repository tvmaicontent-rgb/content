import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { googleSheetsService } from '../../services/googleSheetsService';
import {
  Link2,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  RefreshCw,
  Clock,
  Send,
  HelpCircle,
  FileSpreadsheet,
  Check,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { SPREADSHEET_URL, KAM_SPREADSHEET_URL } from '../../constants';

interface GoogleSheetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: () => void;
}

export const GoogleSheetsModal: React.FC<GoogleSheetsModalProps> = ({
  isOpen,
  onClose,
  onSyncComplete,
}) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    spreadsheetName?: string;
  } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'settings' | 'instructions' | 'log'>('settings');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      setWebhookUrl(googleSheetsService.getWebhookUrl());
      setLogs(googleSheetsService.getPushLog());
      setTestResult(null);
    }
  }, [isOpen]);

  const handleSaveUrl = () => {
    googleSheetsService.setWebhookUrl(webhookUrl);
    handleTestConnection();
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const res = await googleSheetsService.testWebhook(webhookUrl);
    setIsTesting(false);
    setTestResult(res);
    setLogs(googleSheetsService.getPushLog());
  };

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Загрузка свежих данных из Google Sheets...');
    const res = await googleSheetsService.syncAll();
    setIsSyncing(false);
    if (res.success) {
      setSyncStatus(`Успешно загружено: ${res.contentCount + res.kamCount} товаров, ${res.tasksCount} задач, ${res.groupsCount} групп`);
      if (onSyncComplete) onSyncComplete();
    } else {
      setSyncStatus(`Ошибка: ${res.error || 'Не удалось синхронизировать'}`);
    }
    setTimeout(() => setSyncStatus(null), 6000);
  };

  const appsScriptCode = `/**
 * GOOGLE APPS SCRIPT ДЛЯ ДВУСТОРОННЕЙ СИНХРОНИЗАЦИИ
 * Панель управления отделом контента и КАМ
 */

function doGet(e) {
  return handleRequest(e ? e.parameter : {});
}

function doPost(e) {
  var data = {};
  if (e && e.postData && e.postData.contents) {
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      data = e.parameter || {};
    }
  } else if (e && e.parameter) {
    data = e.parameter;
  }
  return handleRequest(data);
}

function handleRequest(data) {
  var action = data.action || 'ping';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var response = { success: false, action: action, timestamp: new Date().toISOString() };

  try {
    if (action === 'ping' || action === 'test') {
      response.success = true;
      response.message = 'Связь с Google Таблицей активна';
      response.spreadsheetName = ss.getName();
    } else if (action === 'updateProductStatus') {
      var dept = data.department || 'Отдел контента';
      var sheetName = (dept.indexOf('КАМ') !== -1 || dept.indexOf('Коммерческий') !== -1)
        ? 'Коммерческий отдел' : 'Отдел контента';
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        var allSheets = ss.getSheets();
        for (var i = 0; i < allSheets.length; i++) {
          if (allSheets[i].getName().indexOf('контент') !== -1 && sheetName === 'Отдел контента') { sheet = allSheets[i]; break; }
          if ((allSheets[i].getName().indexOf('КАМ') !== -1 || allSheets[i].getName().indexOf('Коммерч') !== -1) && sheetName === 'Коммерческий отдел') { sheet = allSheets[i]; break; }
        }
      }
      if (!sheet) throw new Error('Лист "' + sheetName + '" не найден');

      var files = data.files || [];
      var updates = data.updates || {};
      var fileSet = {};
      for (var f = 0; f < files.length; f++) fileSet[files[f].toLowerCase().trim()] = true;

      var range = sheet.getDataRange();
      var vals = range.getValues();
      var count = 0;

      for (var r = 1; r < vals.length; r++) {
        var rowSource = (vals[r][11] || '').toString().toLowerCase().trim();
        var rowCode = (vals[r][1] || '').toString().trim();
        if (fileSet[rowSource] || (data.externalCodes && data.externalCodes.indexOf(rowCode) !== -1)) {
          if (updates.status !== undefined) vals[r][4] = updates.status;
          if (updates.pauseReason !== undefined) vals[r][5] = updates.pauseReason;
          if (updates.pauseDate !== undefined) vals[r][6] = updates.pauseDate;
          if (updates.executor !== undefined) vals[r][7] = updates.executor;
          if (updates.dateTaken !== undefined) vals[r][8] = updates.dateTaken;
          if (updates.dateCompleted !== undefined) vals[r][9] = updates.dateCompleted;
          if (updates.dateFinished !== undefined) vals[r][10] = updates.dateFinished;
          count++;
        }
      }
      if (count > 0) range.setValues(vals);

      var wName = sheetName === 'Коммерческий отдел' ? 'Рабочие группы КАМ' : 'Рабочие группы контент';
      var wSheet = ss.getSheetByName(wName);
      if (wSheet) {
        var wRange = wSheet.getDataRange();
        var wVals = wRange.getValues();
        var wMod = false;
        for (var wr = 1; wr < wVals.length; wr++) {
          var wFile = (wVals[wr][0] || '').toString().toLowerCase().trim();
          if (fileSet[wFile]) {
            if (updates.status !== undefined) wVals[wr][6] = updates.status;
            if (updates.pauseReason !== undefined) wVals[wr][7] = updates.pauseReason;
            if (updates.pauseDate !== undefined) wVals[wr][8] = updates.pauseDate;
            if (updates.executor !== undefined) wVals[wr][9] = updates.executor;
            if (updates.dateTaken !== undefined) wVals[wr][10] = updates.dateTaken;
            if (updates.dateFinished || updates.dateCompleted) wVals[wr][11] = updates.dateFinished || updates.dateCompleted;
            wMod = true;
          }
        }
        if (wMod) wRange.setValues(wVals);
      }
      response.success = true;
      response.updatedRows = count;
      response.message = 'Обновлено ' + count + ' позиций в таблице';
    } else if (action === 'updateGroup') {
      var g3 = (data.group3 || '').toString().trim().toLowerCase();
      var gUp = data.updates || {};
      var tSheets = ['Рабочие группы КАМ', 'Рабочие группы контент', 'Новые товары'];
      for (var s = 0; s < tSheets.length; s++) {
        var gs = ss.getSheetByName(tSheets[s]);
        if (!gs) continue;
        var gr = gs.getDataRange();
        var gv = gr.getValues();
        var gModif = false;
        for (var row = 1; row < gv.length; row++) {
          var cur = (gv[row][1] || gv[row][4] || '').toString().trim().toLowerCase();
          if (cur === g3 || cur.indexOf(g3) !== -1 || g3.indexOf(cur) !== -1) {
            if (tSheets[s] === 'Новые товары') {
              if (gUp.manager !== undefined) gv[row][5] = gUp.manager;
              if (gUp.kamFile !== undefined) {
                var isD = gUp.kamFile === 'Добавлено' || gUp.kamFile === 'да';
                gv[row][7] = isD ? 'TRUE' : 'FALSE';
                gv[row][8] = isD ? 'TRUE' : 'FALSE';
              }
            } else {
              if (gUp.manager !== undefined) gv[row][9] = gUp.manager;
              if (gUp.status !== undefined) gv[row][6] = gUp.status;
            }
            gModif = true;
          }
        }
        if (gModif) gr.setValues(gv);
      }
      response.success = true;
      response.message = 'Группа "' + data.group3 + '" обновлена';
    } else if (action === 'updateTask' || action === 'addTask') {
      var ts = ss.getSheetByName('Задачи');
      if (!ts) {
        ts = ss.insertSheet('Задачи');
        ts.appendRow(['ID', 'Тема', 'Описание', 'Исполнители', 'Статус', 'Срочность', 'Изображения Base64', 'Дата создания', 'Дата обновления']);
      }
      var tD = data.task || {};
      var trR = ts.getDataRange();
      var tv = trR.getValues();
      var f = false;
      for (var rIdx = 1; rIdx < tv.length; rIdx++) {
        if ((tv[rIdx][0] || '').toString() === (tD.id || '').toString()) {
          tv[rIdx][1] = tD.title || tv[rIdx][1];
          tv[rIdx][2] = tD.description || tv[rIdx][2];
          tv[rIdx][3] = tD.executors || tv[rIdx][3];
          tv[rIdx][4] = tD.status || tv[rIdx][4];
          tv[rIdx][5] = tD.urgency || tv[rIdx][5];
          tv[rIdx][6] = tD.imageBase64 || tv[rIdx][6];
          tv[rIdx][8] = tD.updatedAt || new Date().toLocaleString('ru-RU');
          f = true; break;
        }
      }
      if (f) trR.setValues(tv);
      else ts.appendRow([tD.id || String(tv.length), tD.title || '', tD.description || '', tD.executors || '', tD.status || 'Новая', tD.urgency || 'Текущая задача', tD.imageBase64 || '', tD.createdAt || new Date().toLocaleString('ru-RU'), tD.updatedAt || new Date().toLocaleString('ru-RU')]);
      response.success = true;
    } else if (action === 'appendNewProductsBatch' || action === 'addNewProductsBatch') {
      var nSheet = ss.getSheetByName('Новые товары');
      if (!nSheet) {
        var allSh = ss.getSheets();
        for (var si = 0; si < allSh.length; si++) {
          var sName = allSh[si].getName().toLowerCase();
          if (sName.indexOf('нов') !== -1 && sName.indexOf('товар') !== -1) {
            nSheet = allSh[si];
            break;
          }
        }
      }
      if (!nSheet) {
        nSheet = ss.insertSheet('Новые товары');
        nSheet.appendRow(['Внешний код', 'Наименование', 'Дата создания', 'Цифровой код менеджера', 'Название раздела', 'Менеджер', 'Контент', 'Добавлено', 'Выгружено в файл']);
      }

      var bTitle = data.batchTitle || ('📅 ' + Utilities.formatDate(new Date(), 'GMT+3', 'dd.MM.yyyy HH:mm:ss'));
      var bItems = data.items || [];
      if (bItems.length > 0) {
        // Находим РЕАЛЬНУЮ последнюю строку с данными в Колонке 1 (Внешний код),
        // чтобы не перескакивать через пустые строки с формулами FALSE в столбцах H/I
        var maxCheckRow = Math.max(nSheet.getLastRow(), 1);
        var col1Vals = nSheet.getRange(1, 1, maxCheckRow, 1).getValues();
        var realLastRow = 1;
        for (var r = col1Vals.length - 1; r >= 0; r--) {
          var cellVal = col1Vals[r][0];
          if (cellVal !== "" && cellVal !== null && cellVal !== undefined) {
            realLastRow = r + 1;
            break;
          }
        }

        var rows = [];
        // Строка-разделитель партии
        rows.push([bTitle, '', '', '', '', '', '', '', '']);

        for (var bi = 0; bi < bItems.length; bi++) {
          var itm = bItems[bi];
          rows.push([
            itm.externalCode || '',
            itm.title || '',
            itm.createdDate || Utilities.formatDate(new Date(), 'GMT+3', 'dd.MM.yyyy'),
            itm.managerCode || '',
            itm.sectionName || '',
            itm.manager || '',
            itm.content || '',
            itm.isAdded ? 'TRUE' : 'FALSE',
            itm.isExported ? 'TRUE' : 'FALSE'
          ]);
        }

        var startRow = realLastRow + 1;
        var endRow = startRow + rows.length - 1;
        var currentMaxRows = nSheet.getMaxRows();
        if (endRow > currentMaxRows) {
          nSheet.insertRowsAfter(currentMaxRows, (endRow - currentMaxRows) + 50);
        }

        // Записываем всю партию напрямую со следующей свободной строки
        nSheet.getRange(startRow, 1, rows.length, 9).setValues(rows);

        // Выделяем заголовок партии жирным и серым фоном
        try {
          nSheet.getRange(startRow, 1, 1, 9).setFontWeight('bold').setBackground('#f1f5f9');
        } catch(e) {}

        response.success = true;
        response.startRow = startRow;
        response.endRow = endRow;
        response.addedRows = bItems.length;
        response.message = 'Успешно записано ' + bItems.length + ' позиций (строки ' + startRow + '–' + endRow + ') в Google Таблицу!';
      } else {
        response.success = true;
        response.message = 'Список товаров пуст';
      }
    }
  } catch (err) {
    response.success = false;
    response.error = err.toString();
  }
  var out = ContentService.createTextOutput(JSON.stringify(response));
  out.setMimeType(ContentService.MimeType.JSON);
  return out;
}`;

  const copyScriptToClipboard = () => {
    navigator.clipboard.writeText(appsScriptCode);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  const isConnected = Boolean(googleSheetsService.getWebhookUrl());

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="🔗 Связь с Google Таблицами (Двусторонняя синхронизация)"
      maxWidth="max-w-3xl"
    >
      <div className="space-y-5">
        {/* Status Bar */}
        <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="flex items-center gap-3">
            <div
              className={`w-3.5 h-3.5 rounded-full ${
                isConnected
                  ? 'bg-emerald-500 ring-4 ring-emerald-100 animate-pulse'
                  : 'bg-amber-400 ring-4 ring-amber-100'
              }`}
            />
            <div>
              <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                {isConnected ? 'Двусторонняя связь настроена' : 'Режим прямого чтения (без Webhook)'}
              </div>
              <p className="text-[11px] text-slate-500">
                {isConnected
                  ? 'Изменения статусов автоматически отправляются в Google Таблицу'
                  : 'Чтение из таблиц активно. Для обратной записи статусов подключите Apps Script Webhook'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleManualSync}
            disabled={isSyncing}
            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Загрузка...' : 'Обновить данные'}</span>
          </button>
        </div>

        {syncStatus && (
          <div className="p-3 bg-sky-50 border border-sky-200 text-sky-900 rounded-xl text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
            <span>{syncStatus}</span>
          </div>
        )}

        {/* Subtabs */}
        <div className="flex border-b border-slate-200 gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('settings')}
            className={`pb-2.5 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
              activeSubTab === 'settings'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Настройка Webhook</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('instructions')}
            className={`pb-2.5 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
              activeSubTab === 'instructions'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Инструкция и код скрипта (1 мин)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('log')}
            className={`pb-2.5 px-3 text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer ${
              activeSubTab === 'log'
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Журнал отправки ({logs.length})</span>
          </button>
        </div>

        {/* TAB 1: SETTINGS */}
        {activeSubTab === 'settings' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                URL веб-приложения Google Apps Script (Webhook):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                  className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-sky-500 focus:border-sky-500 font-mono bg-white"
                />
                <button
                  type="button"
                  onClick={handleSaveUrl}
                  disabled={isTesting || !webhookUrl.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>{isTesting ? 'Проверка...' : 'Сохранить и проверить'}</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Этот URL генерируется при развертывании скрипта в вашей Google Таблице (вкладка «Инструкция»).
              </p>
            </div>

            {testResult && (
              <div
                className={`p-3.5 rounded-xl border text-xs font-medium flex items-start gap-2.5 ${
                  testResult.success
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    {testResult.success ? 'Связь успешно подтверждена!' : 'Ошибка подключения'}
                  </div>
                  <div className="mt-0.5">{testResult.message}</div>
                  {testResult.spreadsheetName && (
                    <div className="text-[11px] font-mono text-emerald-700 mt-1">
                      Таблица: {testResult.spreadsheetName}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="p-3.5 bg-sky-50/70 border border-sky-100 rounded-xl">
              <div className="text-xs font-bold text-sky-900 mb-1 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-sky-600" />
                <span>Как работает автоматическое обновление:</span>
              </div>
              <ul className="text-[11px] text-sky-800 space-y-1 list-disc list-inside">
                <li>При открытии приложения данные всегда загружаются напрямую из актуальных таблиц.</li>
                <li>Когда вы берете файл в работу, ставите на паузу или завершаете — статус сразу пишется в Google Таблицу.</li>
                <li>Изменение ответственных менеджеров и статусов групп категорий синхронизируется в реальном времени.</li>
                <li>Все действия кэшируются локально (IndexedDB) для мгновенной скорости интерфейса без задержек.</li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 2: INSTRUCTIONS & SCRIPT */}
        {activeSubTab === 'instructions' && (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5 text-xs text-slate-700">
              <div className="font-bold text-slate-900 flex items-center gap-2">
                <span className="w-5 h-5 bg-sky-600 text-white rounded-full flex items-center justify-center text-[10px]">1</span>
                <span>Откройте Google Таблицу и перейдите в редактор скриптов</span>
              </div>
              <p className="pl-7 text-[11px] text-slate-600">
                В меню Google Таблицы нажмите: <strong className="text-slate-800">Расширения → Apps Script</strong> (Extensions → Apps Script).
              </p>

              <div className="font-bold text-slate-900 flex items-center gap-2 pt-1">
                <span className="w-5 h-5 bg-sky-600 text-white rounded-full flex items-center justify-center text-[10px]">2</span>
                <span>Вставьте код и обновите развертывание</span>
              </div>
              <div className="pl-7 text-[11px] text-slate-600 space-y-1">
                <p>
                  Замените код в <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px]">Code.gs</code> на скопированный ниже.
                </p>
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 font-medium">
                  ⚠️ <strong>Если скрипт уже был развернут:</strong> нажмите <strong className="text-slate-900">«Развернуть» (Deploy) → «Управление развертываниями» (Manage deployments) → значок карандаша (Изменить) → в поле «Версия» выберите «Новая версия» → нажмите «Развернуть»</strong>. Без этого Google Sheets продолжит выполнять старую версию скрипта!
                </div>
              </div>

              <div className="font-bold text-slate-900 flex items-center gap-2 pt-1">
                <span className="w-5 h-5 bg-sky-600 text-white rounded-full flex items-center justify-center text-[10px]">3</span>
                <span>Проверьте настройки доступа</span>
              </div>
              <ul className="pl-7 text-[11px] text-slate-600 space-y-1 list-disc list-inside">
                <li>Тип: <strong>Веб-приложение (Web app)</strong></li>
                <li>Запуск от имени: <strong>Я (Me)</strong></li>
                <li>У кого есть доступ (Who has access): <strong className="text-emerald-700">Все (Anyone)</strong> — обязательно!</li>
                <li>Скопируйте полученный URL (заканчивается на <code className="bg-slate-200 px-1 py-0.5 rounded text-[10px]">/exec</code>) и вставьте его во вкладку «Настройка Webhook».</li>
              </ul>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-700">Готовый код Google Apps Script:</span>
                <button
                  type="button"
                  onClick={copyScriptToClipboard}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  {copiedScript ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedScript ? 'Скопировано!' : 'Скопировать весь код'}</span>
                </button>
              </div>

              <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[11px] font-mono overflow-x-auto max-h-64 border border-slate-800">
                {appsScriptCode}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 3: PUSH LOGS */}
        {activeSubTab === 'log' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Последние операции отправки в Google Sheets:</span>
              <button
                type="button"
                onClick={() => setLogs(googleSheetsService.getPushLog())}
                className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> Обновить лог
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                Событий отправки пока нет. Измените статус файла или группы, и запрос автоматически зафиксируется здесь.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {logs.map(item => (
                  <div
                    key={item.id}
                    className={`p-2.5 rounded-xl border text-xs flex items-center justify-between ${
                      item.status === 'success'
                        ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                        : item.status === 'error'
                        ? 'bg-rose-50/60 border-rose-200 text-rose-900'
                        : 'bg-amber-50/60 border-amber-200 text-amber-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {item.status === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : item.status === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
                      )}
                      <div>
                        <div className="font-bold">{item.title}</div>
                        <div className="text-[10px] opacity-80">{item.details}</div>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono opacity-70 shrink-0">{item.time}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <a
              href={SPREADSHEET_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Таблица Контент</span>
            </a>
            <span className="text-slate-300">|</span>
            <a
              href={KAM_SPREADSHEET_URL}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-600 hover:text-sky-700 font-semibold flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Таблица КАМ</span>
            </a>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </Modal>
  );
};
