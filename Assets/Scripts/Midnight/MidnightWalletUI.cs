using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using Midnight;

/// <summary>
/// Clean, minimal Midnight Wallet UI.
/// Creates a modern wallet connection interface at runtime.
/// </summary>
public class MidnightWalletUI : MonoBehaviour
{
    [Header("Auto Create")]
    public bool createOnAwake = true;

    [Header("Colors")]
    public Color bgColor = new Color(0.06f, 0.06f, 0.1f, 0.95f);
    public Color cardColor = new Color(0.1f, 0.1f, 0.15f, 1f);
    public Color midnightPurple = new Color(0.5f, 0.2f, 0.9f, 1f);
    public Color cardanoBlue = new Color(0.2f, 0.4f, 0.9f, 1f);
    public Color accentGreen = new Color(0.2f, 0.9f, 0.5f, 1f);
    public Color textWhite = new Color(0.95f, 0.95f, 0.98f, 1f);
    public Color textDim = new Color(0.5f, 0.5f, 0.6f, 1f);
    public Color errorRed = new Color(0.9f, 0.3f, 0.3f, 1f);

    // UI References
    private GameObject _canvas;
    private GameObject _panel;
    private Text _modeText;
    private Image _modeBadge;
    private Text _statusText;
    private Text _addressText;
    private Text _balanceText;
    private Text _networkText;
    private Button _connectBtn;
    private Text _connectBtnText;
    private Button _copyBtn;
    private Button _refreshBtn;
    
    // Counter UI
    private Text _counterText;
    private Button _readCounterBtn;
    private Button _incrementCounterBtn;

    void Awake()
    {
        if (createOnAwake) CreateUI();
    }

    void Start()
    {
        Debug.Log("[MidnightWalletUI] ═══════════════════════════════════════════");
        Debug.Log("[MidnightWalletUI] Starting Midnight Wallet UI...");
        Debug.Log("[MidnightWalletUI] ═══════════════════════════════════════════");
        
        // Initialize SDK
        MidnightSDK.Initialize(
            onReady: () => {
                Debug.Log("[MidnightWalletUI] ✓ SDK Ready - Wallet detected");
                SetStatus("Wallet detected - Ready to connect");
            },
            onWalletNotFound: () => {
                Debug.LogWarning("[MidnightWalletUI] ✗ Wallet not found");
                SetStatus("Lace wallet not found", true);
            }
        );

        // Subscribe to events
        MidnightSDK.OnConnected += OnConnected;
        MidnightSDK.OnDisconnected += OnDisconnected;
        MidnightSDK.OnError += err => {
            Debug.LogError($"[MidnightWalletUI] Error: {err}");
            SetStatus(err, true);
        };
    }

    void OnDestroy()
    {
        MidnightSDK.OnConnected -= OnConnected;
        MidnightSDK.OnDisconnected -= OnDisconnected;
    }

    // ========================================
    // UI CREATION
    // ========================================

    public void CreateUI()
    {
        // Canvas
        _canvas = new GameObject("MidnightWalletCanvas");
        var canvas = _canvas.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 100;

        var scaler = _canvas.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920, 1080);
        scaler.matchWidthOrHeight = 0.5f;

        _canvas.AddComponent<GraphicRaycaster>();

        // EventSystem
        if (FindObjectOfType<EventSystem>() == null)
        {
            var es = new GameObject("EventSystem");
            es.AddComponent<EventSystem>();
            es.AddComponent<StandaloneInputModule>();
        }

        // Main Panel (centered card) - increased height for counter section
        _panel = CreateCard(_canvas.transform, "WalletPanel", 420, 520);
        
        float y = 170f; // Start from top

        // ── MODE BADGE ──
        var badgeObj = CreateRoundedRect(_panel.transform, "ModeBadge", 200, 36, new Color(0.15f, 0.15f, 0.2f, 1f));
        SetPosition(badgeObj, 0, y);
        _modeBadge = badgeObj.GetComponent<Image>();
        
        _modeText = CreateLabel(_panel.transform, "ModeText", "NOT CONNECTED", 14, FontStyle.Bold);
        SetPosition(_modeText.gameObject, 0, y);
        _modeText.alignment = TextAnchor.MiddleCenter;
        
        y -= 50;

        // ── TITLE ──
        var title = CreateLabel(_panel.transform, "Title", "Midnight Wallet", 22, FontStyle.Bold);
        SetPosition(title.gameObject, 0, y);
        title.alignment = TextAnchor.MiddleCenter;
        
        y -= 35;

        // ── STATUS ──
        _statusText = CreateLabel(_panel.transform, "Status", "Initializing...", 12);
        _statusText.color = textDim;
        SetPosition(_statusText.gameObject, 0, y);
        _statusText.alignment = TextAnchor.MiddleCenter;
        
        y -= 40;

        // ── CONNECT BUTTON ──
        _connectBtn = CreateButton(_panel.transform, "ConnectBtn", "Connect Wallet", midnightPurple, 180, 48);
        SetPosition(_connectBtn.gameObject, 0, y);
        _connectBtnText = _connectBtn.GetComponentInChildren<Text>();
        _connectBtn.onClick.AddListener(OnConnectClick);
        
        y -= 65;

        // ── DIVIDER ──
        var divider = CreateRoundedRect(_panel.transform, "Divider", 360, 1, new Color(0.2f, 0.2f, 0.25f, 1f));
        SetPosition(divider, 0, y);
        
        y -= 25;

        // ── NETWORK ──
        _networkText = CreateLabel(_panel.transform, "Network", "Network: --", 11);
        _networkText.color = textDim;
        SetPosition(_networkText.gameObject, 0, y);
        _networkText.alignment = TextAnchor.MiddleCenter;
        
        y -= 30;

        // ── BALANCE ──
        _balanceText = CreateLabel(_panel.transform, "Balance", "Balance: --", 20, FontStyle.Bold);
        _balanceText.color = accentGreen;
        SetPosition(_balanceText.gameObject, 0, y);
        _balanceText.alignment = TextAnchor.MiddleCenter;
        
        y -= 40;

        // ── ADDRESS ROW ──
        _addressText = CreateLabel(_panel.transform, "Address", "", 11);
        _addressText.color = textDim;
        var addrRect = _addressText.GetComponent<RectTransform>();
        addrRect.anchorMin = new Vector2(0.5f, 0.5f);
        addrRect.anchorMax = new Vector2(0.5f, 0.5f);
        addrRect.sizeDelta = new Vector2(280, 24);
        addrRect.anchoredPosition = new Vector2(-30, y);
        _addressText.alignment = TextAnchor.MiddleCenter;

        _copyBtn = CreateButton(_panel.transform, "CopyBtn", "Copy", new Color(0.25f, 0.25f, 0.3f, 1f), 60, 28);
        SetPosition(_copyBtn.gameObject, 145, y);
        _copyBtn.GetComponentInChildren<Text>().fontSize = 11;
        _copyBtn.onClick.AddListener(OnCopyClick);
        _copyBtn.interactable = false;
        
        y -= 35;

        // ── REFRESH BUTTON ──
        _refreshBtn = CreateButton(_panel.transform, "RefreshBtn", "Refresh Balance", new Color(0.2f, 0.2f, 0.28f, 1f), 140, 32);
        SetPosition(_refreshBtn.gameObject, 0, y);
        _refreshBtn.GetComponentInChildren<Text>().fontSize = 12;
        _refreshBtn.onClick.AddListener(OnRefreshClick);
        _refreshBtn.interactable = false;
        
        y -= 50;

        // ── COUNTER SECTION ──
        var counterDivider = CreateRoundedRect(_panel.transform, "CounterDivider", 360, 1, new Color(0.2f, 0.2f, 0.25f, 1f));
        SetPosition(counterDivider, 0, y);
        
        y -= 20;
        
        var counterTitle = CreateLabel(_panel.transform, "CounterTitle", "Counter Contract", 14, FontStyle.Bold);
        SetPosition(counterTitle.gameObject, 0, y);
        counterTitle.alignment = TextAnchor.MiddleCenter;
        
        y -= 30;
        
        _counterText = CreateLabel(_panel.transform, "CounterValue", "Counter: --", 18, FontStyle.Bold);
        _counterText.color = new Color(0.4f, 0.8f, 1f, 1f); // Cyan
        SetPosition(_counterText.gameObject, 0, y);
        _counterText.alignment = TextAnchor.MiddleCenter;
        
        y -= 40;
        
        // Counter buttons row
        _readCounterBtn = CreateButton(_panel.transform, "ReadCounterBtn", "Read", new Color(0.2f, 0.5f, 0.7f, 1f), 90, 32);
        SetPosition(_readCounterBtn.gameObject, -55, y);
        _readCounterBtn.GetComponentInChildren<Text>().fontSize = 12;
        _readCounterBtn.onClick.AddListener(OnReadCounterClick);
        _readCounterBtn.interactable = false;
        
        _incrementCounterBtn = CreateButton(_panel.transform, "IncrementCounterBtn", "Increment", midnightPurple, 90, 32);
        SetPosition(_incrementCounterBtn.gameObject, 55, y);
        _incrementCounterBtn.GetComponentInChildren<Text>().fontSize = 12;
        _incrementCounterBtn.onClick.AddListener(OnIncrementCounterClick);
        _incrementCounterBtn.interactable = false;
    }

    // ========================================
    // UI HELPERS
    // ========================================

    GameObject CreateCard(Transform parent, string name, float w, float h)
    {
        var obj = new GameObject(name);
        obj.transform.SetParent(parent, false);
        
        var img = obj.AddComponent<Image>();
        img.color = cardColor;
        
        var rect = obj.GetComponent<RectTransform>();
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = new Vector2(w, h);
        rect.anchoredPosition = Vector2.zero;
        
        return obj;
    }

    GameObject CreateRoundedRect(Transform parent, string name, float w, float h, Color color)
    {
        var obj = new GameObject(name);
        obj.transform.SetParent(parent, false);
        
        var img = obj.AddComponent<Image>();
        img.color = color;
        
        var rect = obj.GetComponent<RectTransform>();
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = new Vector2(w, h);
        
        return obj;
    }

    Text CreateLabel(Transform parent, string name, string text, int fontSize, FontStyle style = FontStyle.Normal)
    {
        var obj = new GameObject(name);
        obj.transform.SetParent(parent, false);
        
        var txt = obj.AddComponent<Text>();
        txt.text = text;
        txt.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        txt.fontSize = fontSize;
        txt.fontStyle = style;
        txt.color = textWhite;
        txt.alignment = TextAnchor.MiddleCenter;
        
        var rect = obj.GetComponent<RectTransform>();
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = new Vector2(380, fontSize + 10);
        
        return txt;
    }

    Button CreateButton(Transform parent, string name, string label, Color color, float w, float h)
    {
        var obj = new GameObject(name);
        obj.transform.SetParent(parent, false);
        
        var img = obj.AddComponent<Image>();
        img.color = color;
        
        var btn = obj.AddComponent<Button>();
        btn.targetGraphic = img;
        
        var colors = btn.colors;
        colors.highlightedColor = new Color(color.r + 0.1f, color.g + 0.1f, color.b + 0.1f, 1f);
        colors.pressedColor = new Color(color.r - 0.1f, color.g - 0.1f, color.b - 0.1f, 1f);
        colors.disabledColor = new Color(0.2f, 0.2f, 0.25f, 0.5f);
        btn.colors = colors;
        
        var rect = obj.GetComponent<RectTransform>();
        rect.anchorMin = new Vector2(0.5f, 0.5f);
        rect.anchorMax = new Vector2(0.5f, 0.5f);
        rect.sizeDelta = new Vector2(w, h);
        
        // Label
        var labelObj = new GameObject("Label");
        labelObj.transform.SetParent(obj.transform, false);
        
        var txt = labelObj.AddComponent<Text>();
        txt.text = label;
        txt.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        txt.fontSize = 14;
        txt.fontStyle = FontStyle.Bold;
        txt.color = textWhite;
        txt.alignment = TextAnchor.MiddleCenter;
        
        var labelRect = labelObj.GetComponent<RectTransform>();
        labelRect.anchorMin = Vector2.zero;
        labelRect.anchorMax = Vector2.one;
        labelRect.offsetMin = Vector2.zero;
        labelRect.offsetMax = Vector2.zero;
        
        return btn;
    }

    void SetPosition(GameObject obj, float x, float y)
    {
        var rect = obj.GetComponent<RectTransform>();
        rect.anchoredPosition = new Vector2(x, y);
    }

    // ========================================
    // EVENT HANDLERS
    // ========================================

    void OnConnectClick()
    {
        Debug.Log("[MidnightWalletUI] Connect button clicked");
        
        if (MidnightSDK.IsConnected)
        {
            Debug.Log("[MidnightWalletUI] Already connected - disconnecting...");
            MidnightSDK.Disconnect();
        }
        else
        {
            Debug.Log("[MidnightWalletUI] Not connected - initiating connection...");
            SetStatus("Connecting...");
            _connectBtn.interactable = false;
            MidnightSDK.Connect(
                onSuccess: null,
                onError: err => {
                    Debug.LogError($"[MidnightWalletUI] Connection failed: {err}");
                    SetStatus(err, true);
                    _connectBtn.interactable = true;
                }
            );
        }
    }

    void OnCopyClick()
    {
        if (MidnightSDK.Wallet != null)
        {
            MidnightSDK.CopyToClipboard(MidnightSDK.Wallet.Address);
            SetStatus("Address copied!");
        }
    }

    void OnRefreshClick()
    {
        SetStatus("Refreshing...");
        MidnightSDK.GetBalance(
            onSuccess: balance => {
                _balanceText.text = balance.NativeFormatted;
                SetStatus("Balance updated");
            },
            onError: err => SetStatus(err, true)
        );
    }

    void OnReadCounterClick()
    {
        SetStatus("Reading counter...");
        _readCounterBtn.interactable = false;
        MidnightSDK.ReadCounter(
            onSuccess: result => {
                _counterText.text = $"Counter: {result.Counter}";
                SetStatus("Counter read successfully");
                _readCounterBtn.interactable = true;
            },
            onError: err => {
                SetStatus(err, true);
                _readCounterBtn.interactable = true;
            }
        );
    }

    void OnIncrementCounterClick()
    {
        SetStatus("Incrementing counter...");
        _incrementCounterBtn.interactable = false;
        MidnightSDK.IncrementCounter(
            onSuccess: result => {
                _counterText.text = $"Counter: {result.Counter}";
                SetStatus($"Incremented! TX: {TruncateAddress(result.TxHash ?? "")}");
                _incrementCounterBtn.interactable = true;
            },
            onError: err => {
                SetStatus(err, true);
                _incrementCounterBtn.interactable = true;
            }
        );
    }

    void OnConnected(MidnightSDK.WalletInfo wallet)
    {
        Debug.Log("[MidnightWalletUI] ═══════════════════════════════════════════");
        Debug.Log("[MidnightWalletUI] ✓ WALLET CONNECTED!");
        Debug.Log($"[MidnightWalletUI]   Mode: {wallet.Mode.ToUpper()}");
        Debug.Log($"[MidnightWalletUI]   Network: {wallet.Network}");
        Debug.Log($"[MidnightWalletUI]   Address: {wallet.Address}");
        Debug.Log("[MidnightWalletUI] ═══════════════════════════════════════════");
        
        // Update mode badge
        if (wallet.IsMidnight)
        {
            _modeText.text = $"MIDNIGHT {wallet.Network.ToUpper()}";
            _modeBadge.color = midnightPurple;
            Debug.Log("[MidnightWalletUI] UI updated for MIDNIGHT mode (purple badge)");
        }
        else
        {
            _modeText.text = $"CARDANO {wallet.Network.ToUpper()}";
            _modeBadge.color = cardanoBlue;
            Debug.LogWarning("[MidnightWalletUI] UI updated for CARDANO mode (blue badge) - not Midnight!");
        }

        // Update UI
        _connectBtnText.text = "Disconnect";
        _connectBtn.interactable = true;
        _connectBtn.GetComponent<Image>().color = new Color(0.4f, 0.2f, 0.2f, 1f);
        
        _networkText.text = $"Network: {wallet.Network}";
        _addressText.text = TruncateAddress(wallet.Address);
        
        _copyBtn.interactable = true;
        _refreshBtn.interactable = true;
        
        // Enable counter buttons (Midnight only)
        _readCounterBtn.interactable = wallet.IsMidnight;
        _incrementCounterBtn.interactable = wallet.IsMidnight;

        SetStatus(wallet.IsMidnight ? "Connected to Midnight" : "Connected (Cardano mode)");

        // Fetch balance
        Debug.Log("[MidnightWalletUI] Fetching initial balance...");
        OnRefreshClick();
    }

    void OnDisconnected()
    {
        Debug.Log("[MidnightWalletUI] Wallet disconnected");
        
        _modeText.text = "NOT CONNECTED";
        _modeBadge.color = new Color(0.15f, 0.15f, 0.2f, 1f);
        
        _connectBtnText.text = "Connect Wallet";
        _connectBtn.interactable = true;
        _connectBtn.GetComponent<Image>().color = midnightPurple;
        
        _networkText.text = "Network: --";
        _balanceText.text = "Balance: --";
        _addressText.text = "";
        
        _copyBtn.interactable = false;
        _refreshBtn.interactable = false;
        
        // Disable counter buttons
        _readCounterBtn.interactable = false;
        _incrementCounterBtn.interactable = false;
        _counterText.text = "Counter: --";

        SetStatus("Disconnected");
    }

    void SetStatus(string msg, bool isError = false)
    {
        _statusText.text = msg;
        _statusText.color = isError ? errorRed : textDim;
    }

    string TruncateAddress(string addr)
    {
        if (string.IsNullOrEmpty(addr) || addr.Length <= 20) return addr;
        return $"{addr.Substring(0, 10)}...{addr.Substring(addr.Length - 8)}";
    }
}
