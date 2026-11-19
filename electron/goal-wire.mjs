const goalTools=new Set(['get_goal','create_goal','update_goal']);
const nativeGoal=/^goal-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export function goalWire(messages,protect){
 const calls=new Set(),ids=new Set();
 for(const message of messages){
  if(message.role!=='assistant')continue;
  for(const block of Array.isArray(message.content)?message.content:[]){
   if(block.type==='tool_use'&&goalTools.has(block.name))calls.add(block.id);
  }
  for(const call of Array.isArray(message.tool_calls)?message.tool_calls:[]){
   if(goalTools.has(call.function?.name))calls.add(call.id);
  }
 }
 function parse(text){
  if(typeof text!=='string')return null;
  try{
   const record=JSON.parse(text);
   const id=record?.goal?.id;
   if(typeof id==='string'&&nativeGoal.test(id)&&Number.isSafeInteger(record.goal.revision))return record;
  }catch{}
  return null;
 }
 function forResult(content,callId,transform){
  if(!calls.has(callId))return undefined;
  if(typeof content==='string')return transform(content);
  if(!Array.isArray(content))return undefined;
  for(const block of content)if(block?.type==='text')transform(block.text);
 }
 for(const message of messages){
  const remember=text=>{const value=parse(text);if(value)ids.add(value.goal.id);};
  if(message.role==='tool')forResult(message.content,message.tool_call_id,remember);
  for(const block of message.role==='user'&&Array.isArray(message.content)?message.content:[]){
   if(block.type==='tool_result')forResult(block.content,block.tool_use_id,remember);
  }
 }
 function result(callId,text){
  const value=calls.has(callId)?parse(text):null;
  if(!value)return protect(text);
  const {goal,...fields}=value;
  const {id,...properties}=goal;
  // The ID is a generated protocol address. Protect every user-controlled value
  // around it, including the objective and the reason supplied by the model.
  return JSON.stringify({...protect(fields),goal:{...protect(properties),id}});
 }
 function input(name,value){
  if(name!=='update_goal'||!ids.has(value?.goal_id))return protect(value);
  const {goal_id,...rest}=value;
  return {...protect(rest),goal_id};
 }
 return {result,input};
}
