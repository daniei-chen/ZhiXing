// Shell executors merge this overlay with the Harness environment. Blank every
// nonessential inherited variable, including future bridge/MCP/auth variables.
const ESSENTIAL = new Set(['path','systemroot','windir','comspec','pathext','temp','tmp','userprofile','appdata','localappdata','programfiles','programfiles(x86)','programdata','systemdrive']);
export function shellEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, ESSENTIAL.has(key.toLowerCase()) ? value : '']));
}

export function planningAllows(name, args = {}) {
  return ['office_calculate','office_calendar','office_table_check','office_read_file','office_list_files','skill','ask_user_question','exit_plan_mode','get_goal','team_task_list','team_task_get','web_search','web_fetch','list_mcp_resources','list_mcp_resource_templates','read_mcp_resource'].includes(name)
    || name === 'office_browser' && ['list','snapshot'].includes(args.operation)
    || name === 'office_schedule' && ['list','view'].includes(args.operation);
}
