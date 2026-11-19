export function PluginBuildApproval({approval,busy,onReview}){
 if(!approval)return null;
 return <section className="plugin-preview" aria-label="待审阅的构建脚本">
  <p>安装已暂停，以下依赖需要运行构建脚本。</p>
  <ul>{approval.pendingBuilds.map(name=><li key={name}><code>{name}</code></li>)}</ul>
  <div className="form-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>onReview(approval.approvalId)}>审阅构建脚本</button></div>
 </section>;
}
