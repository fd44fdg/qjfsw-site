const CONFIG = {
    API_KEY: '', // 安全考虑：由远程 Worker (api.qjfsw.xyz) 处理，不需要在客户端填写
    API_URL: 'https://api.qjfsw.xyz/api/chat',
    // 备用本地开发地址 (由 npm start 启动的 node server):
    // API_URL: 'http://localhost:3001/api/chat',
    MODEL: 'minimaxai/minimax-m2.1'
};
// 说明：API 已通过 api.qjfsw.xyz 域名代理，以解决移动端无法直连 workers.dev 的问题。
