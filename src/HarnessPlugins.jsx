import { useEffect, useState } from 'react';
import { ArrowClockwise, CaretRight, DownloadSimple, MagnifyingGlass, Package, Plus, Trash } from '@phosphor-icons/react';
import { IconButton, Modal } from './ui.jsx';
import {PluginBuildApproval} from './PluginBuildApproval.jsx';

const desktop = window.zhixing?.manageHarnessPlugins;
const messages = {
  'unsupported-platform': '当前 Windows 版本不支持此插件。',
  'not-a-bundle': '此包没有声明 Harness 插件。',
  'not-bundle': '此包没有可加载的 Harness 插件。',
  'incompatible-version': '此版本与知行当前的 Harness 不兼容。',
  'unexpected-package': '下载内容和选中的包名或版本不一致。',
  'already-installed': '此包已经安装。',
  'not-found': '仓库里找不到此插件或版本。',
  'network': '无法连接插件仓库。',
  'management-required': '插件管理依赖此组件。',
};
const errorText = error => error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');

export function HarnessPlugins() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [screen, setScreen] = useState(null);
  const [spec, setSpec] = useState('');
  const [inspection, setInspection] = useState(null);
  const [versions, setVersions] = useState([]);
  const [version, setVersion] = useState('');
  const [buildApproval,setBuildApproval]=useState(null);
  const shown = rows.filter(row => row.selectable && `${row.title} ${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const installed = shown.filter(row => row.installed || row.enabled);
  const official = shown.filter(row => (row.official && !row.installed && !row.enabled));

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    setBusy('list');
    desktop({ action: 'list' }).then(value => { if (active) setRows(value); })
      .catch(error => { if (active) setNotice({ text: errorText(error), error: true }); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, []);

  async function action(input, success) {
    if (!desktop || busy) return;
    setBusy(input.action);
    setNotice(null);
    setBuildApproval(null);
    try {
      const result = await desktop(input);
      if (input.action === 'list') { setRows(result); return; }
      if (input.action === 'inspect') { setInspection(result); return; }
      if (input.action === 'versions') {
        if (result.problem) throw new Error(messages[result.problem] || '可更新版本暂不可用。');
        const available = result.versions.filter(row => row.bundle && !row.incompatible && !row.deprecated);
        setVersions(available);
        setVersion(available[0]?.version || '');
        if (!available.length) setNotice({ text: '暂无更新的兼容版本。' });
        return;
      }
      if (result.cancelled) return;
      if(result.approvalId){setBuildApproval(result);return;}
      const failed = ['failed', 'cancelled', 'overridden'].includes(result.application);
      setRows(await desktop({ action: 'list' }));
      if (failed) throw new Error(result.buildScripts ? '该包需要运行安装脚本，当前未安装。' : messages[result.error] || '插件操作未完成，请检查版本和网络。');
      setNotice({ text: success });
      setScreen(null);
    } catch (error) { setNotice({ text: errorText(error), error: true }); }
    finally { setBusy(''); }
  }

  function detail(row) {
    setNotice(null);
    setBuildApproval(null);
    setVersions([]);
    setVersion('');
    setScreen({ type: 'detail', row });
  }

  function card(row) {
    return <button type="button" className="connection-card harness-plugin-card" key={row.name} onClick={() => detail(row)}>
      <span className="connection-icon"><Package size={20}/></span>
      <span><strong>{row.title}</strong><small>{row.error === 'unsupported-platform' ? '当前平台不支持' : row.enabled ? '已启用 · 完全访问' : row.installed ? `已安装 · ${row.version || '版本未知'}` : row.available === 'installation' ? '随内核提供' : `可安装 · ${row.offeredVersion || ''}`}</small></span>
      <CaretRight size={15}/>
    </button>;
  }

  const row = screen?.row;
  const feedback = <>
   {notice&&<p role={notice.error ? 'alert' : 'status'} className={`setting-notice ${notice.error ? 'bad' : ''}`}>{notice.text}</p>}
   <PluginBuildApproval approval={buildApproval} busy={!!busy} onReview={approvalId=>action({action:'confirm-builds',approvalId},'安装完成。新版保持停用。')}/>
  </>;
  return <div className="connections-page harness-plugin-page" aria-busy={!!busy}>
    <header className="connections-heading">
      <div><h1>Harness 插件</h1><p>为项目交办添加工具和工作能力。</p></div>
      <div><label className="connections-search"><MagnifyingGlass size={15}/><input aria-label="搜索 Harness 插件" placeholder="搜索 Harness 插件" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <IconButton icon={ArrowClockwise} label="刷新 Harness 插件" disabled={!!busy || !desktop} onClick={() => action({ action: 'list' })}/>
      <button type="button" className="primary-button" disabled={!!busy || !desktop} onClick={() => { setSpec(''); setInspection(null); setNotice(null); setBuildApproval(null); setScreen({ type: 'add' }); }}><Plus size={15}/>添加</button></div>
    </header>
    {!desktop && <p className="empty-note">在 Windows 桌面端管理 Harness 插件。</p>}
    {busy === 'list' && !rows.length && <p className="empty-note" role="status">正在读取官方目录…</p>}
    {installed.length > 0 && <><h3>已安装与启用</h3><div className="connection-grid">{installed.map(card)}</div></>}
    {official.length > 0 && <><h3>官方目录</h3><div className="connection-grid">{official.map(card)}</div></>}
    {query && !shown.length && <p className="empty-note">没有匹配的插件。</p>}
    {!screen && feedback}
    {screen?.type === 'add' && <Modal title="添加 npm 插件" onClose={busy ? () => {} : () => setScreen(null)}>
      <form onSubmit={event => { event.preventDefault(); setInspection(null); void action({ action: 'inspect', spec }); }}>
        <label className="form-label">npm 包名<input aria-label="npm 包名" value={spec} required maxLength={270} placeholder="@组织/插件 或 名称@版本" onChange={event => { setSpec(event.target.value); setInspection(null); }}/></label>
        <div className="form-actions"><button className="secondary-button" disabled={!!busy || !spec.trim()}>{busy === 'inspect' ? '正在读取…' : '查看插件'}</button></div>
      </form>
      {inspection?.problem && <p role="alert" className="setting-notice bad">{messages[inspection.problem] || '插件信息暂不可用。'}</p>}
      {inspection?.bundle && <div className="plugin-preview">
        <strong>{inspection.name} · {inspection.version}</strong>
        {inspection.description && <p className="muted">{inspection.description}</p>}
        <p className="muted">安装后保持停用。需要在插件详情中信任并启用。</p>
        <div className="form-actions"><button type="button" className="primary-button" disabled={!!busy} onClick={() => action({ action: 'install', name: inspection.name, version: inspection.version }, '已安装，等你启用。')}><DownloadSimple size={15}/>{busy === 'install' ? '正在安装…' : '安装此版本'}</button></div>
      </div>}
      {feedback}
    </Modal>}
    {screen?.type === 'detail' && row && <Modal title={row.title} onClose={busy ? () => {} : () => setScreen(null)}>
      <div className="plugin-preview">
        <p className="muted">{row.name}{row.version ? ` · ${row.version}` : ''}</p>
        {row.description && <p>{row.description}</p>}
        {row.error && <p className="setting-notice bad">{messages[row.error] || '此插件暂不可用。'}</p>}
        {row.entries.length > 0 && <details><summary>组件 · {row.entries.length}</summary><ul>{row.entries.map(entry => <li key={entry.id}>{entry.title || entry.name}</li>)}</ul></details>}
        {!!versions.length && <label className="form-label">新版本<select aria-label="新版本" value={version} onChange={event => setVersion(event.target.value)}>{versions.map(item => <option value={item.version} key={item.version}>{item.version}</option>)}</select><small>更新后停用，请确认新版后重新启用。</small></label>}
      </div>
      <div className="form-actions plugin-actions">
        {row.removable && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => setScreen({ type: 'remove', row })}><Trash size={15}/>移除</button>}
        {row.update && !versions.length && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => action({ action: 'versions', name: row.name })}>检查更新</button>}
        {!!version && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => action({ action: 'update', name: row.name, version }, '已更新。新版保持停用。')}>安装 {version}</button>}
        {row.available === 'missing' && row.offeredVersion && !row.error && <button type="button" className="primary-button" disabled={!!busy} onClick={() => action({ action: 'install', name: row.name, version: row.offeredVersion, official: true }, '已安装，等你启用。')}>安装官方版本</button>}
        {row.available !== 'missing' && (!row.error || row.enabled) && !row.readOnly && <button type="button" className={row.enabled ? 'secondary-button' : 'primary-button'} disabled={!!busy} onClick={() => action({ action: 'enable', name: row.name, enabled: !row.enabled }, row.enabled ? '已停用。' : '已启用。选择「完全访问」的项目交办可使用。')}>{row.enabled ? '停用' : '启用'}</button>}
      </div>
      {feedback}
    </Modal>}
    {screen?.type === 'remove' && row && <Modal title="移除插件" onClose={busy ? () => {} : () => detail(row)}>
      <p className="modal-copy">移除「{row.title}」？需要时可重新安装。</p>
      {feedback}
      <div className="form-actions"><button type="button" className="secondary-button" disabled={!!busy} onClick={() => detail(row)}>取消</button>
      <button type="button" className="danger-button" disabled={!!busy} onClick={() => action({ action: 'remove', name: row.name }, '已移除。')}>移除插件</button></div>
    </Modal>}
  </div>;
}
