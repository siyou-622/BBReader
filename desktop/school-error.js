const params=new URLSearchParams(location.search);
document.getElementById('schoolError').textContent=params.get('message')||'学校网络连接失败，请稍后重试。';
try{const target=new URL(params.get('retry'));if(['https://bb.sustech.edu.cn','https://cas.sustech.edu.cn'].includes(target.origin)&&!target.username&&!target.password)document.getElementById('retrySchool').href=target.href;}catch{}
