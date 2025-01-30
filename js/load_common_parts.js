// ヘッダー読み込み(共通)
fetch("common/header.html")
    .then((response) => response.text())
    .then((data) => document.querySelector("#header").innerHTML = data);

// フッター読み込み(共通)
fetch("common/footer.html")
    .then((response) => response.text())
    .then((data) => document.querySelector("#footer").innerHTML = data);