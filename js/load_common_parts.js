// ロードアニメーション用
window.onload = function () {
    const loading_anim = document.getElementById("loading");
    // 0.2秒待っておく
    setTimeout(() => {
        loading_anim.classList.add("loaded");
        document.body.classList.remove("loading");
    },200);
};

// 遷移アニメーション用
document.body.addEventListener("click", function (e) {
  const link = e.target.closest("a[href]");
  if (!link) return;

  const href = link.href;
  if (
    href.startsWith("http") && !href.includes(location.hostname) ||
    href.includes("#") ||
    link.target === "_blank"
  ) return;

  e.preventDefault();
  const transition = document.getElementById("transition");
  transition.classList.add("active");

  setTimeout(() => {
    window.location.href = href;
  }, 300);
});

// ヘッダー読み込み
fetch("common/header.html")
    .then((response) => response.text())
    .then((data) => document.querySelector("#header").innerHTML = data);

// フッター読み込み
fetch("common/footer.html")
    .then((response) => response.text())
    .then((data) => document.querySelector("#footer").innerHTML = data);

// パートナーバナー読み込み
fetch("common/partner_baner.html")
    .then((response) => response.text())
    .then((data) => document.querySelector("#partner_baner").innerHTML = data);