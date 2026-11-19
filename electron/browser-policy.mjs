export function browserUrl(input){
 if(typeof input!=='string'||input.length>4096||!input.trim())throw new Error('请输入网页地址。');
 const value=input.trim();let url;
 const loopback=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value);
 try{url=new URL(loopback?`http://${value}`:/^[a-z][\w+.-]*:/i.test(value)?value:`https://${value}`);}catch{throw new Error('网页地址无效。');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅可打开不含账号密码的 HTTP 或 HTTPS 网页。');
 return url.href;
}
export function browserBounds(value,windowSize){
 if(!value||!['x','y','width','height'].every(key=>Number.isFinite(value[key])))throw new Error('浏览器区域无效。');
 const x=Math.max(0,Math.min(windowSize[0],Math.round(value.x))),y=Math.max(42,Math.min(windowSize[1],Math.round(value.y)));
 return {x,y,width:Math.max(0,Math.min(windowSize[0]-x,Math.round(value.width))),height:Math.max(0,Math.min(windowSize[1]-y,Math.round(value.height)))};
}
