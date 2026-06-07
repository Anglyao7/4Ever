import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Code2, KeyRound, Mail, MapPin, Phone, ShieldCheck, Upload, UserRound, type LucideIcon } from "lucide-react";

import { changePassword, resolveMediaUrl, updateCurrentUser, uploadCurrentUserAvatar, uploadCurrentUserCover } from "./services/api";
import type { AuthUser } from "./types/auth";

type ProfileDraft = {
  display_name: string;
  email: string;
  bio: string;
  location: string;
};

type ProfileView = "home" | "profile" | "password" | "platforms" | "email";
type PlatformStatus = "active" | "disabled";
type PlatformKey = "linuxdo" | "github" | "email" | "phone";
type LocationDraft = {
  province: string;
  city: string;
};

export default function ProfilePanel(props: { authToken: string; currentUser: AuthUser | null; onUserChange: (user: AuthUser) => void }) {
  const [view, setView] = useState<ProfileView>("home");
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFromUser(props.currentUser));
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(() => parseLocation(props.currentUser?.location));
  const [password, setPassword] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const heroCoverInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(draftFromUser(props.currentUser));
    setLocationDraft(parseLocation(props.currentUser?.location));
  }, [props.currentUser]);

  const displayName = props.currentUser?.display_name || props.currentUser?.username || "我";
  const avatarUrl = resolveMediaUrl(props.currentUser?.avatar_url);
  const heroCoverUrl = resolveMediaUrl(props.currentUser?.cover_url);
  const initial = displayName.slice(0, 1).toUpperCase();
  const profileBio = props.currentUser?.bio?.trim() || "还没有设置签名";
  const profileLocation = props.currentUser?.location?.trim() || "未设置所在地";
  const provinceOptions = chinaProvinces.map((province) => province.name);
  const cityOptions = citiesFor(locationDraft.province);
  const platforms = platformItems(props.currentUser);

  async function saveProfile() {
    if (!props.authToken) return;
    setSaving("profile");
    setMessage("");
    setError("");
    try {
      const updated = await updateCurrentUser(props.authToken, {
        display_name: draft.display_name.trim(),
        email: draft.email.trim(),
        bio: draft.bio.trim(),
        location: formatLocation(locationDraft),
      });
      props.onUserChange(updated);
      setMessage("资料已保存。");
      setView("home");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "资料保存失败");
    } finally {
      setSaving("");
    }
  }

  async function savePassword() {
    if (!props.authToken) return;
    if (password.new_password !== password.confirm_password) {
      setError("两次输入的新密码不一致。");
      return;
    }
    if (password.new_password.length < 6) {
      setError("新密码至少 6 位。");
      return;
    }
    setSaving("password");
    setMessage("");
    setError("");
    try {
      await changePassword(props.authToken, { current_password: password.current_password, new_password: password.new_password });
      setPassword({ current_password: "", new_password: "", confirm_password: "" });
      setMessage("密码已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "密码修改失败");
    } finally {
      setSaving("");
    }
  }

  async function uploadAvatar(file: File | null | undefined) {
    if (!props.authToken || !file) return;
    setSaving("avatar");
    setMessage("");
    setError("");
    try {
      const dataBase64 = await fileToBase64(file);
      const updated = await uploadCurrentUserAvatar(props.authToken, { filename: file.name, content_type: file.type, data_base64: dataBase64 });
      props.onUserChange(updated);
      setMessage("头像已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "头像上传失败");
    } finally {
      setSaving("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function uploadHeroCover(file: File | null | undefined) {
    if (!props.authToken || !file) return;
    setSaving("hero-cover");
    setMessage("");
    setError("");
    try {
      const dataBase64 = await fileToBase64(file);
      const updated = await uploadCurrentUserCover(props.authToken, { filename: file.name, content_type: file.type, data_base64: dataBase64 });
      props.onUserChange(updated);
      setMessage("主页背景已更新。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "主页背景上传失败");
    } finally {
      setSaving("");
      if (heroCoverInputRef.current) heroCoverInputRef.current.value = "";
    }
  }

  if (!props.currentUser) {
    return <section className="self-panel"><div className="token-login-empty"><UserRound size={24} /><strong>需要登录</strong><p>登录后可以管理个人资料。</p></div></section>;
  }

  function openView(nextView: ProfileView) {
    setMessage("");
    setError("");
    setView(nextView);
  }

  function goHome() {
    setMessage("");
    setError("");
    setDraft(draftFromUser(props.currentUser));
    setLocationDraft(parseLocation(props.currentUser?.location));
    setPassword({ current_password: "", new_password: "", confirm_password: "" });
    setView("home");
  }

  return (
    <section className="self-panel">
      <div className="module-view-header">
        <div><p className="eyebrow">账户</p><h1>个人中心</h1><span className="module-view-subtitle">头像、签名、所在地和账号安全</span></div>
      </div>

      {(message || error) && <p className={`self-message ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error || message}</p>}

      {view === "home" ? (
        <div className="self-home-grid">
          <article className={`self-profile-hero ${heroCoverUrl ? "has-cover" : ""}`} style={heroCoverUrl ? { backgroundImage: `url(${heroCoverUrl})` } : undefined}>
            <input ref={heroCoverInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadHeroCover(event.target.files?.[0])} />
            <button className="self-cover-upload" type="button" disabled={saving === "hero-cover"} onClick={() => heroCoverInputRef.current?.click()}>
              <Upload size={14} />
              <span>{saving === "hero-cover" ? "上传中" : "上传背景"}</span>
            </button>
            <span className="self-avatar self-home-avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : initial}</span>
            <div className="self-home-copy">
              <strong>{displayName}</strong>
              <span>@{props.currentUser.username}</span>
              <p>{profileBio}</p>
            </div>
            <div className="self-home-meta" aria-label="账号信息">
              <span><Mail size={14} />{props.currentUser.email || "未绑定邮箱"}</span>
              <span><MapPin size={14} />{profileLocation}</span>
              <span><ShieldCheck size={14} />{props.currentUser.role === "admin" ? "管理员" : "成员"}</span>
            </div>
          </article>

          <div className="self-home-actions">
            <button className="self-action-card" type="button" onClick={() => openView("profile")}>
              <span><UserRound size={18} /></span>
              <strong>修改资料</strong>
              <small>头像、签名、所在地</small>
            </button>
            <button className="self-action-card" type="button" onClick={() => openView("password")}>
              <span><KeyRound size={18} /></span>
              <strong>修改密码</strong>
              <small>更新账号登录密码</small>
            </button>
            <button className="self-action-card" type="button" onClick={() => openView("platforms")}>
              <span><ShieldCheck size={18} /></span>
              <strong>绑定平台</strong>
              <small>邮箱可绑定，其他暂未开放</small>
            </button>
          </div>
        </div>
      ) : (
        <article className="self-card self-subpage">
          <div className="self-subpage-head">
            <button className="secondary-button compact" type="button" onClick={goHome}><ArrowLeft size={15} /><span>返回</span></button>
            <div>
              <h2>{viewTitle(view)}</h2>
            </div>
          </div>

          {view === "profile" && (
            <div className="self-form-grid self-form-wide">
              <div className="self-avatar-editor">
                <span className="self-avatar self-avatar-upload">{avatarUrl ? <img src={avatarUrl} alt="" /> : initial}</span>
                <div className="self-avatar-editor-body">
                  <strong>{displayName}</strong>
                  <p>{props.currentUser.email}</p>
                  <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
                  <button className="secondary-button compact" type="button" disabled={saving === "avatar"} onClick={() => fileInputRef.current?.click()}>
                    <Upload size={15} />
                    <span>{saving === "avatar" ? "上传中" : "上传头像"}</span>
                  </button>
                </div>
              </div>
              <label><span>显示名称</span><input value={draft.display_name} onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))} /></label>
              <label><span>邮箱</span><input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
              <div className="self-location-picker">
                <label><span>省份</span><select value={locationDraft.province} onChange={(event) => setLocationDraft((current) => normalizeLocationDraft({ ...current, province: event.target.value, city: "" }))}>{provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}</select></label>
                <label><span>城市</span><select value={locationDraft.city} onChange={(event) => setLocationDraft((current) => normalizeLocationDraft({ ...current, city: event.target.value }))}>{cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}</select></label>
              </div>
              <label><span>签名</span><textarea value={draft.bio} maxLength={280} placeholder="写一句自己的签名" onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))} /></label>
              <button className="primary-action compact" type="button" disabled={saving === "profile" || !draft.display_name.trim() || !draft.email.trim()} onClick={saveProfile}>
                <Check size={15} />
                <span>{saving === "profile" ? "保存中" : "保存资料"}</span>
              </button>
            </div>
          )}

          {view === "password" && (
            <div className="self-form-grid self-form-compact">
              <label><span>当前密码</span><input type="password" value={password.current_password} onChange={(event) => setPassword((current) => ({ ...current, current_password: event.target.value }))} /></label>
              <label><span>新密码</span><input type="password" minLength={6} value={password.new_password} onChange={(event) => setPassword((current) => ({ ...current, new_password: event.target.value }))} /></label>
              <label><span>确认新密码</span><input type="password" minLength={6} value={password.confirm_password} onChange={(event) => setPassword((current) => ({ ...current, confirm_password: event.target.value }))} /></label>
              <button className="primary-action compact" type="button" disabled={saving === "password" || !password.current_password || !password.new_password || !password.confirm_password} onClick={savePassword}>
                <ShieldCheck size={15} />
                <span>{saving === "password" ? "更新中" : "更新密码"}</span>
              </button>
            </div>
          )}

          {view === "platforms" && (
            <div className="profile-platform-grid">
              {platforms.map((platform) => {
                const Icon = platform.icon;
                const disabled = platform.status === "disabled";
                return (
                  <button
                    key={platform.id}
                    className={`profile-platform-item ${platform.status === "active" ? "active" : ""} ${disabled ? "disabled" : ""}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => openView(platform.target)}
                  >
                    <Icon size={18} />
                    <span>
                      <strong>{platform.name}</strong>
                      <small>{platform.description}</small>
                    </span>
                    <em>{platform.detail}</em>
                  </button>
                );
              })}
            </div>
          )}

          {view === "email" && (
            <div className="self-form-grid self-form-compact">
              <label><span>邮箱</span><input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></label>
              <button className="primary-action compact" type="button" disabled={saving === "profile" || !draft.display_name.trim() || !draft.email.trim()} onClick={saveProfile}>
                <Check size={15} />
                <span>{saving === "profile" ? "绑定中" : "保存邮箱"}</span>
              </button>
            </div>
          )}
        </article>
      )}
    </section>
  );
}

function draftFromUser(user: AuthUser | null): ProfileDraft {
  return {
    display_name: user?.display_name ?? "",
    email: user?.email ?? "",
    bio: user?.bio ?? "",
    location: user?.location ?? "",
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("头像读取失败"));
    reader.readAsDataURL(file);
  });
}

function viewTitle(view: ProfileView) {
  if (view === "password") return "修改密码";
  if (view === "platforms") return "绑定平台";
  if (view === "email") return "邮箱绑定";
  return "修改资料";
}

const chinaProvinces = [
      { name: "北京市", cities: ["北京市"] },
      { name: "天津市", cities: ["天津市"] },
      { name: "上海市", cities: ["上海市"] },
      { name: "重庆市", cities: ["重庆市"] },
      { name: "河北省", cities: ["石家庄市", "唐山市", "秦皇岛市", "邯郸市", "保定市", "张家口市", "承德市", "沧州市", "廊坊市", "衡水市"] },
      { name: "山西省", cities: ["太原市", "大同市", "阳泉市", "长治市", "晋城市", "朔州市", "晋中市", "运城市", "忻州市", "临汾市", "吕梁市"] },
      { name: "内蒙古自治区", cities: ["呼和浩特市", "包头市", "乌海市", "赤峰市", "通辽市", "鄂尔多斯市", "呼伦贝尔市", "巴彦淖尔市", "乌兰察布市"] },
      { name: "辽宁省", cities: ["沈阳市", "大连市", "鞍山市", "抚顺市", "本溪市", "丹东市", "锦州市", "营口市", "阜新市", "辽阳市", "盘锦市", "铁岭市", "朝阳市", "葫芦岛市"] },
      { name: "吉林省", cities: ["长春市", "吉林市", "四平市", "辽源市", "通化市", "白山市", "松原市", "白城市", "延边朝鲜族自治州"] },
      { name: "黑龙江省", cities: ["哈尔滨市", "齐齐哈尔市", "鸡西市", "鹤岗市", "双鸭山市", "大庆市", "伊春市", "佳木斯市", "七台河市", "牡丹江市", "黑河市", "绥化市", "大兴安岭地区"] },
      { name: "江苏省", cities: ["南京市", "无锡市", "徐州市", "常州市", "苏州市", "南通市", "连云港市", "淮安市", "盐城市", "扬州市", "镇江市", "泰州市", "宿迁市"] },
      { name: "浙江省", cities: ["杭州市", "宁波市", "温州市", "嘉兴市", "湖州市", "绍兴市", "金华市", "衢州市", "舟山市", "台州市", "丽水市"] },
      { name: "安徽省", cities: ["合肥市", "芜湖市", "蚌埠市", "淮南市", "马鞍山市", "淮北市", "铜陵市", "安庆市", "黄山市", "滁州市", "阜阳市", "宿州市", "六安市", "亳州市", "池州市", "宣城市"] },
      { name: "福建省", cities: ["福州市", "厦门市", "莆田市", "三明市", "泉州市", "漳州市", "南平市", "龙岩市", "宁德市"] },
      { name: "江西省", cities: ["南昌市", "景德镇市", "萍乡市", "九江市", "新余市", "鹰潭市", "赣州市", "吉安市", "宜春市", "抚州市", "上饶市"] },
      { name: "山东省", cities: ["济南市", "青岛市", "淄博市", "枣庄市", "东营市", "烟台市", "潍坊市", "济宁市", "泰安市", "威海市", "日照市", "临沂市", "德州市", "聊城市", "滨州市", "菏泽市"] },
      { name: "河南省", cities: ["郑州市", "开封市", "洛阳市", "平顶山市", "安阳市", "鹤壁市", "新乡市", "焦作市", "濮阳市", "许昌市", "漯河市", "三门峡市", "南阳市", "商丘市", "信阳市", "周口市", "驻马店市"] },
      { name: "湖北省", cities: ["武汉市", "黄石市", "十堰市", "宜昌市", "襄阳市", "鄂州市", "荆门市", "孝感市", "荆州市", "黄冈市", "咸宁市", "随州市", "恩施土家族苗族自治州"] },
      { name: "湖南省", cities: ["长沙市", "株洲市", "湘潭市", "衡阳市", "邵阳市", "岳阳市", "常德市", "张家界市", "益阳市", "郴州市", "永州市", "怀化市", "娄底市", "湘西土家族苗族自治州"] },
      { name: "广东省", cities: ["广州市", "深圳市", "珠海市", "汕头市", "佛山市", "韶关市", "河源市", "梅州市", "惠州市", "汕尾市", "东莞市", "中山市", "江门市", "阳江市", "湛江市", "茂名市", "肇庆市", "清远市", "潮州市", "揭阳市", "云浮市"] },
      { name: "广西壮族自治区", cities: ["南宁市", "柳州市", "桂林市", "梧州市", "北海市", "防城港市", "钦州市", "贵港市", "玉林市", "百色市", "贺州市", "河池市", "来宾市", "崇左市"] },
      { name: "海南省", cities: ["海口市", "三亚市", "三沙市", "儋州市"] },
      { name: "四川省", cities: ["成都市", "自贡市", "攀枝花市", "泸州市", "德阳市", "绵阳市", "广元市", "遂宁市", "内江市", "乐山市", "南充市", "眉山市", "宜宾市", "广安市", "达州市", "雅安市", "巴中市", "资阳市", "阿坝藏族羌族自治州", "甘孜藏族自治州", "凉山彝族自治州"] },
      { name: "贵州省", cities: ["贵阳市", "六盘水市", "遵义市", "安顺市", "毕节市", "铜仁市", "黔西南布依族苗族自治州", "黔东南苗族侗族自治州", "黔南布依族苗族自治州"] },
      { name: "云南省", cities: ["昆明市", "曲靖市", "玉溪市", "保山市", "昭通市", "丽江市", "普洱市", "临沧市", "楚雄彝族自治州", "红河哈尼族彝族自治州", "文山壮族苗族自治州", "西双版纳傣族自治州", "大理白族自治州", "德宏傣族景颇族自治州", "怒江傈僳族自治州", "迪庆藏族自治州"] },
      { name: "西藏自治区", cities: ["拉萨市", "日喀则市", "昌都市", "林芝市", "山南市", "那曲市", "阿里地区"] },
      { name: "陕西省", cities: ["西安市", "铜川市", "宝鸡市", "咸阳市", "渭南市", "延安市", "汉中市", "榆林市", "安康市", "商洛市"] },
      { name: "甘肃省", cities: ["兰州市", "嘉峪关市", "金昌市", "白银市", "天水市", "武威市", "张掖市", "平凉市", "酒泉市", "庆阳市", "定西市", "陇南市", "临夏回族自治州", "甘南藏族自治州"] },
      { name: "青海省", cities: ["西宁市", "海东市", "海北藏族自治州", "黄南藏族自治州", "海南藏族自治州", "果洛藏族自治州", "玉树藏族自治州", "海西蒙古族藏族自治州"] },
      { name: "宁夏回族自治区", cities: ["银川市", "石嘴山市", "吴忠市", "固原市", "中卫市"] },
      { name: "新疆维吾尔自治区", cities: ["乌鲁木齐市", "克拉玛依市", "吐鲁番市", "哈密市", "昌吉回族自治州", "博尔塔拉蒙古自治州", "巴音郭楞蒙古自治州", "阿克苏地区", "克孜勒苏柯尔克孜自治州", "喀什地区", "和田地区", "伊犁哈萨克自治州", "塔城地区", "阿勒泰地区"] },
      { name: "香港特别行政区", cities: ["香港"] },
      { name: "澳门特别行政区", cities: ["澳门"] },
      { name: "台湾省", cities: ["台北市", "新北市", "桃园市", "台中市", "台南市", "高雄市"] },
];

function citiesFor(provinceName: string) {
  return chinaProvinces.find((province) => province.name === provinceName)?.cities ?? chinaProvinces[0]?.cities ?? [];
}

function normalizeLocationDraft(value: Partial<LocationDraft>): LocationDraft {
  const province = chinaProvinces.find((item) => item.name === value.province)?.name ?? chinaProvinces[0].name;
  const cities = citiesFor(province);
  const city = cities.includes(value.city ?? "") ? value.city ?? "" : cities[0] ?? "";
  return { province, city };
}

function parseLocation(value?: string | null): LocationDraft {
  const raw = (value ?? "").trim();
  if (!raw) return normalizeLocationDraft({});
  const parts = raw.split(/[\/,，、\s]+/).map((part) => part.trim()).filter(Boolean);
  const province = chinaProvinces.find((item) => parts.includes(item.name) || raw.includes(item.name.replace(/省|市|自治区|特别行政区/g, "")))?.name;
  const selectedProvince = province ?? chinaProvinces.find((item) => item.cities.some((city) => parts.includes(city) || raw.includes(city.replace(/市/g, ""))))?.name;
  const city = selectedProvince ? citiesFor(selectedProvince).find((item) => parts.includes(item) || raw.includes(item.replace(/市/g, ""))) : "";
  return normalizeLocationDraft({ province: selectedProvince, city });
}

function formatLocation(value: LocationDraft) {
  const normalized = normalizeLocationDraft(value);
  return [normalized.province, normalized.city].filter(Boolean).join(" / ");
}

function platformItems(user: AuthUser | null): Array<{
  id: PlatformKey;
  name: string;
  description: string;
  detail: string;
  status: PlatformStatus;
  target: ProfileView;
  icon: LucideIcon;
}> {
  return [
    {
      id: "linuxdo",
      name: "LinuxDo",
      description: "社区账号",
      detail: "暂未开放",
      status: "disabled",
      target: "platforms",
      icon: UserRound,
    },
    {
      id: "github",
      name: "GitHub",
      description: "开发者账号",
      detail: "暂未开放",
      status: "disabled",
      target: "platforms",
      icon: Code2,
    },
    {
      id: "email",
      name: "邮箱",
      description: user?.email || "未绑定邮箱",
      detail: user?.email ? "已绑定" : "去绑定",
      status: "active",
      target: "email",
      icon: Mail,
    },
    {
      id: "phone",
      name: "手机号",
      description: "手机登录与验证",
      detail: "暂未开放",
      status: "disabled",
      target: "platforms",
      icon: Phone,
    },
  ];
}
