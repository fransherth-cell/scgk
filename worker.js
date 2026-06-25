// Cloudflare Worker - xorpay payment
const API_URL = "https://pay.xorpay.cn/api/pay/705899";

function md5(a){function b(c,d){for(var e=c[0],f=c[1],g=c[2],h=c[3],i,j=0;j<64;j++){if(j<16){i=(f&g|~f&h)+e+d[j]+r[j]|0}else if(j<32){i=(f&h|g&~h)+e+d[s[j]]+r[j]|0}else if(j<48){i=(f^g^h)+e+d[t[j]]+r[j]|0}else{i=(g^(f|~h))+e+d[u[j]]+r[j]|0}e=h,h=g,g=f,f=i+v[j]+e|0}c[0]=c[0]+e|0,c[1]=c[1]+f|0,c[2]=c[2]+g|0,c[3]=c[3]+h|0}var r=[-680876936,-389564586,606105819,-1044525330,-176418897,1200080426,-1473231341,-45705983,1770035416,-1958414417,-42063,-1990404162,1804603682,-40341101,-1502002290,1236535329,-165796510,-1069501632,643717713,-373897302,-701558691,38016083,-660478335,-405537848,568446438,-1019803690,-187363961,1163531501,-1444681467,-51403784,1735328473,-1926607734,-378558,-2022574463,1839030562,-35309556,-1530992060,1272893353,-155497632,-1094730640,681279174,-358537222,-722521979,76029189,-640364487,-421815835,530742520,-995338651,-198630844,1126891415,-1416354905,-57434055,1700485571,-1894986606,-1051523,-2054922799,1873313359,-30611744,-1560198380,1309151649,-145523070,-1120210379,718787259,-343485551],v=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21],s=[1,6,11,0,5,10,15,4,9,14,3,8,13,2,7,12],t=[5,8,11,14,1,4,7,10,13,0,3,6,9,12,15,2],u=[0,7,14,5,12,3,10,1,8,15,6,13,4,11,2,9];var w=new TextEncoder().encode(a),x=w.length,y=new Array(16);for(var z=[1732584193,-271733879,-1732584194,271733878],A=0;A<=x;A+=64){for(var j=0;j<16;j++)y[j]=w[A+j*4]|(w[A+j*4+1]||0)<<8|(w[A+j*4+2]||0)<<16|(w[A+j*4+3]||0)<<24;if(A+64<=x)b(z,y);else{var B=x-A;if(B===64){b(z,y);break}y[B>>2]|=128<<(B&3)*8;if(B>=56){b(z,y);for(j=0;j<16;j++)y[j]=0}y[14]=x*8;b(z,y);break}}var C='';for(j=0;j<4;j++)for(var k=0;k<4;k++)C+=((z[j]>>>k*8)&255).toString(16).padStart(2,'0');return C}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }});
    }

    if (url.pathname === "/debug") {
      // Debug endpoint to verify MD5
      const secret = env.XORPAY_SECRET || "";
      const testStr = url.searchParams.get("s") || "测试支付native0.01test123https://dry-river-8f8a.fransherth.workers.dev/callback" + secret;
      return Response.json({ str: testStr, md5: md5(testStr), secretLen: secret.length });
    }

    if (url.pathname === "/create-order" && request.method === "POST") {
      const { price, name } = await request.json();
      const orderId = "SC" + Date.now();
      const notifyUrl = url.origin + "/callback";
      const signStr = name + "native" + price + orderId + notifyUrl + env.XORPAY_SECRET;
      const sign = md5(signStr);

      const body = new URLSearchParams({ name, pay_type: "native", price, order_id: orderId, notify_url: notifyUrl, sign });
      const res = await fetch(API_URL, { method: "POST", body });
      const data = await res.json();

      return Response.json({ order_id: orderId, sign: sign, sign_str: signStr, raw: data }, {
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    if (url.pathname === "/callback") {
      console.log("Payment callback:", await request.text());
      return new Response("success");
    }

    return new Response("scgk114.com", { headers: { "Access-Control-Allow-Origin": "*" }});
  }
};
