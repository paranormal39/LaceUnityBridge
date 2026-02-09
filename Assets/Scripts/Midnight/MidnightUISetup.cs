using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

/// <summary>
/// Editor utility script to create the Midnight Wallet UI at runtime.
/// Attach this to an empty GameObject and it will create the full UI hierarchy.
/// 
/// Alternatively, you can manually create the UI in the Editor and assign
/// references to MidnightBridge directly.
/// </summary>
public class MidnightUISetup : MonoBehaviour
{
    [Header("Settings")]
    [Tooltip("If true, creates UI automatically on Awake")]
    public bool createOnAwake = true;

    [Header("Styling")]
    public Color backgroundColor = new Color(0.1f, 0.1f, 0.15f, 1f);
    public Color panelColor = new Color(0.15f, 0.15f, 0.2f, 0.95f);
    public Color buttonColor = new Color(0.3f, 0.5f, 0.9f, 1f);
    public Color textColor = Color.white;
    public Color addressColor = new Color(0.5f, 0.8f, 0.5f, 1f);

    [Header("Counter Configuration")]
    [Tooltip("Blockfrost Project ID for Preprod. Leave empty to set at runtime.")]
    public string blockfrostProjectId = "";
    
    [Tooltip("Script address of the Aiken counter contract")]
    public string counterScriptAddress = "addr_test1wq0666pyk48q4v2zgjgdd4fuzn3xg2lzhsvueduvjxjuksqc7yh2n";

    private void Awake()
    {
        if (createOnAwake)
        {
            CreateMidnightUI();
        }
    }

    /// <summary>
    /// Creates the complete Midnight wallet connection UI.
    /// </summary>
    public void CreateMidnightUI()
    {
        // Create Canvas
        GameObject canvasObj = new GameObject("MidnightCanvas");
        Canvas canvas = canvasObj.AddComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        canvas.sortingOrder = 100;

        CanvasScaler scaler = canvasObj.AddComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1920, 1080);
        scaler.matchWidthOrHeight = 0.5f;

        canvasObj.AddComponent<GraphicRaycaster>();

        // Create EventSystem if one doesn't exist (required for UI input)
        if (FindObjectOfType<EventSystem>() == null)
        {
            GameObject eventSystemObj = new GameObject("EventSystem");
            eventSystemObj.AddComponent<EventSystem>();
            eventSystemObj.AddComponent<StandaloneInputModule>();
            Debug.Log("[MidnightUISetup] Created EventSystem for UI input");
        }

        // Create background panel (larger to fit send transaction UI)
        GameObject panelObj = CreatePanel(canvasObj.transform, "WalletPanel", panelColor);
        RectTransform panelRect = panelObj.GetComponent<RectTransform>();
        panelRect.anchorMin = new Vector2(0.5f, 0.5f);
        panelRect.anchorMax = new Vector2(0.5f, 0.5f);
        panelRect.sizeDelta = new Vector2(550, 620);
        panelRect.anchoredPosition = Vector2.zero;

        // Create title
        GameObject titleObj = CreateText(panelObj.transform, "Title", "Lace Wallet", 32, TextAnchor.MiddleCenter);
        RectTransform titleRect = titleObj.GetComponent<RectTransform>();
        titleRect.anchorMin = new Vector2(0, 1);
        titleRect.anchorMax = new Vector2(1, 1);
        titleRect.pivot = new Vector2(0.5f, 1);
        titleRect.sizeDelta = new Vector2(0, 50);
        titleRect.anchoredPosition = new Vector2(0, -10);

        // Create status text
        GameObject statusObj = CreateText(panelObj.transform, "StatusText", "Detecting wallet...", 18, TextAnchor.MiddleCenter);
        RectTransform statusRect = statusObj.GetComponent<RectTransform>();
        statusRect.anchorMin = new Vector2(0, 1);
        statusRect.anchorMax = new Vector2(1, 1);
        statusRect.pivot = new Vector2(0.5f, 1);
        statusRect.sizeDelta = new Vector2(0, 30);
        statusRect.anchoredPosition = new Vector2(0, -60);
        Text statusText = statusObj.GetComponent<Text>();

        // Create address row container
        GameObject addressRowObj = new GameObject("AddressRow");
        addressRowObj.transform.SetParent(panelObj.transform, false);
        RectTransform addressRowRect = addressRowObj.AddComponent<RectTransform>();
        addressRowRect.anchorMin = new Vector2(0, 1);
        addressRowRect.anchorMax = new Vector2(1, 1);
        addressRowRect.pivot = new Vector2(0.5f, 1);
        addressRowRect.sizeDelta = new Vector2(-40, 35);
        addressRowRect.anchoredPosition = new Vector2(0, -95);

        // Create address text (clickable area)
        GameObject addressObj = CreateText(addressRowObj.transform, "AddressText", "", 14, TextAnchor.MiddleLeft);
        RectTransform addressRect = addressObj.GetComponent<RectTransform>();
        addressRect.anchorMin = new Vector2(0, 0);
        addressRect.anchorMax = new Vector2(0.8f, 1);
        addressRect.offsetMin = Vector2.zero;
        addressRect.offsetMax = Vector2.zero;
        Text addressText = addressObj.GetComponent<Text>();
        addressText.color = addressColor;

        // Create copy button
        GameObject copyBtnObj = CreateButton(addressRowObj.transform, "CopyButton", "Copy", new Color(0.4f, 0.4f, 0.5f, 1f));
        RectTransform copyBtnRect = copyBtnObj.GetComponent<RectTransform>();
        copyBtnRect.anchorMin = new Vector2(0.82f, 0);
        copyBtnRect.anchorMax = new Vector2(1, 1);
        copyBtnRect.offsetMin = Vector2.zero;
        copyBtnRect.offsetMax = Vector2.zero;
        Button copyButton = copyBtnObj.GetComponent<Button>();
        copyBtnObj.GetComponentInChildren<Text>().fontSize = 14;

        // Create connect button
        GameObject connectBtnObj = CreateButton(panelObj.transform, "ConnectButton", "Connect Lace", buttonColor);
        RectTransform connectBtnRect = connectBtnObj.GetComponent<RectTransform>();
        connectBtnRect.anchorMin = new Vector2(0.5f, 1);
        connectBtnRect.anchorMax = new Vector2(0.5f, 1);
        connectBtnRect.pivot = new Vector2(0.5f, 1);
        connectBtnRect.sizeDelta = new Vector2(180, 45);
        connectBtnRect.anchoredPosition = new Vector2(0, -140);
        Button connectButton = connectBtnObj.GetComponent<Button>();
        Text connectButtonText = connectBtnObj.GetComponentInChildren<Text>();

        // === BALANCE DISPLAY SECTION ===
        
        // Network text (shows which network: mainnet, preprod, preview, testnet)
        GameObject networkObj = CreateText(panelObj.transform, "NetworkText", "Network: --", 14, TextAnchor.MiddleCenter);
        RectTransform networkRect = networkObj.GetComponent<RectTransform>();
        networkRect.anchorMin = new Vector2(0, 1);
        networkRect.anchorMax = new Vector2(1, 1);
        networkRect.pivot = new Vector2(0.5f, 1);
        networkRect.sizeDelta = new Vector2(0, 25);
        networkRect.anchoredPosition = new Vector2(0, -190);
        Text networkText = networkObj.GetComponent<Text>();
        networkText.color = new Color(0.7f, 0.7f, 0.8f, 1f); // Gray initially

        // Balance text (main native balance)
        GameObject balanceObj = CreateText(panelObj.transform, "BalanceText", "Balance: --", 20, TextAnchor.MiddleCenter);
        RectTransform balanceRect = balanceObj.GetComponent<RectTransform>();
        balanceRect.anchorMin = new Vector2(0, 1);
        balanceRect.anchorMax = new Vector2(1, 1);
        balanceRect.pivot = new Vector2(0.5f, 1);
        balanceRect.sizeDelta = new Vector2(0, 35);
        balanceRect.anchoredPosition = new Vector2(0, -215);
        Text balanceText = balanceObj.GetComponent<Text>();
        balanceText.color = new Color(0.4f, 0.9f, 0.4f, 1f); // Green for balance

        // Token list container (for other tokens on the side)
        GameObject tokenListObj = new GameObject("TokenListContainer");
        tokenListObj.transform.SetParent(panelObj.transform, false);
        RectTransform tokenListRect = tokenListObj.AddComponent<RectTransform>();
        tokenListRect.anchorMin = new Vector2(1, 0.5f);
        tokenListRect.anchorMax = new Vector2(1, 1);
        tokenListRect.pivot = new Vector2(0, 0.5f);
        tokenListRect.sizeDelta = new Vector2(180, 0);
        tokenListRect.anchoredPosition = new Vector2(20, -50);
        
        // Add vertical layout group for token list
        UnityEngine.UI.VerticalLayoutGroup tokenLayout = tokenListObj.AddComponent<UnityEngine.UI.VerticalLayoutGroup>();
        tokenLayout.childAlignment = TextAnchor.UpperLeft;
        tokenLayout.spacing = 5;
        tokenLayout.childControlHeight = false;
        tokenLayout.childControlWidth = true;
        tokenLayout.childForceExpandHeight = false;
        tokenLayout.childForceExpandWidth = true;

        // Token list title
        GameObject tokenTitleObj = CreateText(tokenListObj.transform, "TokenListTitle", "Other Tokens:", 14, TextAnchor.MiddleLeft);
        RectTransform tokenTitleRect = tokenTitleObj.GetComponent<RectTransform>();
        tokenTitleRect.sizeDelta = new Vector2(180, 20);
        Text tokenTitleText = tokenTitleObj.GetComponent<Text>();
        tokenTitleText.color = new Color(0.7f, 0.7f, 0.8f, 1f);

        // === SEND TRANSACTION SECTION ===
        
        // Divider line
        GameObject dividerObj = CreatePanel(panelObj.transform, "Divider", new Color(0.3f, 0.3f, 0.4f, 1f));
        RectTransform dividerRect = dividerObj.GetComponent<RectTransform>();
        dividerRect.anchorMin = new Vector2(0, 1);
        dividerRect.anchorMax = new Vector2(1, 1);
        dividerRect.pivot = new Vector2(0.5f, 1);
        dividerRect.sizeDelta = new Vector2(-40, 2);
        dividerRect.anchoredPosition = new Vector2(0, -240);

        // Send section title
        GameObject sendTitleObj = CreateText(panelObj.transform, "SendTitle", "Send Transaction", 20, TextAnchor.MiddleCenter);
        RectTransform sendTitleRect = sendTitleObj.GetComponent<RectTransform>();
        sendTitleRect.anchorMin = new Vector2(0, 1);
        sendTitleRect.anchorMax = new Vector2(1, 1);
        sendTitleRect.pivot = new Vector2(0.5f, 1);
        sendTitleRect.sizeDelta = new Vector2(0, 35);
        sendTitleRect.anchoredPosition = new Vector2(0, -255);

        // Recipient label
        GameObject recipientLabelObj = CreateText(panelObj.transform, "RecipientLabel", "Recipient Address:", 14, TextAnchor.MiddleLeft);
        RectTransform recipientLabelRect = recipientLabelObj.GetComponent<RectTransform>();
        recipientLabelRect.anchorMin = new Vector2(0, 1);
        recipientLabelRect.anchorMax = new Vector2(1, 1);
        recipientLabelRect.pivot = new Vector2(0.5f, 1);
        recipientLabelRect.sizeDelta = new Vector2(-40, 25);
        recipientLabelRect.anchoredPosition = new Vector2(0, -295);

        // Recipient input field
        GameObject recipientInputObj = CreateInputField(panelObj.transform, "RecipientInput", "Enter recipient address...");
        RectTransform recipientInputRect = recipientInputObj.GetComponent<RectTransform>();
        recipientInputRect.anchorMin = new Vector2(0, 1);
        recipientInputRect.anchorMax = new Vector2(1, 1);
        recipientInputRect.pivot = new Vector2(0.5f, 1);
        recipientInputRect.sizeDelta = new Vector2(-40, 35);
        recipientInputRect.anchoredPosition = new Vector2(0, -325);
        InputField recipientInput = recipientInputObj.GetComponent<InputField>();

        // Amount label
        GameObject amountLabelObj = CreateText(panelObj.transform, "AmountLabel", "Amount (lovelace):", 14, TextAnchor.MiddleLeft);
        RectTransform amountLabelRect = amountLabelObj.GetComponent<RectTransform>();
        amountLabelRect.anchorMin = new Vector2(0, 1);
        amountLabelRect.anchorMax = new Vector2(1, 1);
        amountLabelRect.pivot = new Vector2(0.5f, 1);
        amountLabelRect.sizeDelta = new Vector2(-40, 25);
        amountLabelRect.anchoredPosition = new Vector2(0, -365);

        // Amount input field
        GameObject amountInputObj = CreateInputField(panelObj.transform, "AmountInput", "1000000 (1 ADA)");
        RectTransform amountInputRect = amountInputObj.GetComponent<RectTransform>();
        amountInputRect.anchorMin = new Vector2(0, 1);
        amountInputRect.anchorMax = new Vector2(1, 1);
        amountInputRect.pivot = new Vector2(0.5f, 1);
        amountInputRect.sizeDelta = new Vector2(-40, 35);
        amountInputRect.anchoredPosition = new Vector2(0, -395);
        InputField amountInput = amountInputObj.GetComponent<InputField>();
        amountInput.contentType = InputField.ContentType.IntegerNumber;

        // Transaction status text
        GameObject txStatusObj = CreateText(panelObj.transform, "TxStatusText", "", 14, TextAnchor.MiddleCenter);
        RectTransform txStatusRect = txStatusObj.GetComponent<RectTransform>();
        txStatusRect.anchorMin = new Vector2(0, 1);
        txStatusRect.anchorMax = new Vector2(1, 1);
        txStatusRect.pivot = new Vector2(0.5f, 1);
        txStatusRect.sizeDelta = new Vector2(-40, 25);
        txStatusRect.anchoredPosition = new Vector2(0, -435);
        Text txStatusText = txStatusObj.GetComponent<Text>();
        txStatusText.color = new Color(1f, 0.8f, 0.3f, 1f);

        // Send button
        GameObject sendBtnObj = CreateButton(panelObj.transform, "SendButton", "Send", new Color(0.2f, 0.7f, 0.3f, 1f));
        RectTransform sendBtnRect = sendBtnObj.GetComponent<RectTransform>();
        sendBtnRect.anchorMin = new Vector2(0.5f, 1);
        sendBtnRect.anchorMax = new Vector2(0.5f, 1);
        sendBtnRect.pivot = new Vector2(0.5f, 1);
        sendBtnRect.sizeDelta = new Vector2(150, 45);
        sendBtnRect.anchoredPosition = new Vector2(0, -470);
        Button sendButton = sendBtnObj.GetComponent<Button>();

        // === COUNTER SECTION ===
        
        // Counter divider
        GameObject counterDividerObj = CreatePanel(panelObj.transform, "CounterDivider", new Color(0.3f, 0.3f, 0.4f, 1f));
        RectTransform counterDividerRect = counterDividerObj.GetComponent<RectTransform>();
        counterDividerRect.anchorMin = new Vector2(0, 1);
        counterDividerRect.anchorMax = new Vector2(1, 1);
        counterDividerRect.pivot = new Vector2(0.5f, 1);
        counterDividerRect.sizeDelta = new Vector2(-40, 2);
        counterDividerRect.anchoredPosition = new Vector2(0, -525);

        // Counter status text (shows above the value)
        GameObject counterStatusObj = CreateText(panelObj.transform, "CounterStatusText", "Ready", 12, TextAnchor.MiddleCenter);
        RectTransform counterStatusRect = counterStatusObj.GetComponent<RectTransform>();
        counterStatusRect.anchorMin = new Vector2(0, 1);
        counterStatusRect.anchorMax = new Vector2(1, 1);
        counterStatusRect.pivot = new Vector2(0.5f, 1);
        counterStatusRect.sizeDelta = new Vector2(0, 18);
        counterStatusRect.anchoredPosition = new Vector2(0, -520);
        Text counterStatusText = counterStatusObj.GetComponent<Text>();
        counterStatusText.color = new Color(0.6f, 0.6f, 0.7f, 1f);

        // Counter value text
        GameObject counterValueObj = CreateText(panelObj.transform, "CounterText", "Counter: --", 24, TextAnchor.MiddleCenter);
        RectTransform counterValueRect = counterValueObj.GetComponent<RectTransform>();
        counterValueRect.anchorMin = new Vector2(0, 1);
        counterValueRect.anchorMax = new Vector2(1, 1);
        counterValueRect.pivot = new Vector2(0.5f, 1);
        counterValueRect.sizeDelta = new Vector2(0, 30);
        counterValueRect.anchoredPosition = new Vector2(0, -535);
        Text counterText = counterValueObj.GetComponent<Text>();
        counterText.color = new Color(0.3f, 0.8f, 1f, 1f); // Cyan for counter

        // Counter buttons row
        GameObject counterButtonsRow = new GameObject("CounterButtonsRow");
        counterButtonsRow.transform.SetParent(panelObj.transform, false);
        RectTransform counterButtonsRect = counterButtonsRow.AddComponent<RectTransform>();
        counterButtonsRect.anchorMin = new Vector2(0.5f, 1);
        counterButtonsRect.anchorMax = new Vector2(0.5f, 1);
        counterButtonsRect.pivot = new Vector2(0.5f, 1);
        counterButtonsRect.sizeDelta = new Vector2(340, 35);
        counterButtonsRect.anchoredPosition = new Vector2(0, -570);

        // Refresh Counter button (left)
        GameObject refreshCounterBtnObj = CreateButton(counterButtonsRow.transform, "RefreshCounterButton", "Refresh", new Color(0.2f, 0.5f, 0.7f, 1f));
        RectTransform refreshCounterBtnRect = refreshCounterBtnObj.GetComponent<RectTransform>();
        refreshCounterBtnRect.anchorMin = new Vector2(0, 0);
        refreshCounterBtnRect.anchorMax = new Vector2(0.48f, 1);
        refreshCounterBtnRect.offsetMin = Vector2.zero;
        refreshCounterBtnRect.offsetMax = Vector2.zero;
        Button refreshCounterButton = refreshCounterBtnObj.GetComponent<Button>();
        refreshCounterBtnObj.GetComponentInChildren<Text>().fontSize = 14;

        // Increment Counter button (right)
        GameObject incrementCounterBtnObj = CreateButton(counterButtonsRow.transform, "IncrementCounterButton", "Increment (+1)", new Color(0.6f, 0.3f, 0.7f, 1f));
        RectTransform incrementCounterBtnRect = incrementCounterBtnObj.GetComponent<RectTransform>();
        incrementCounterBtnRect.anchorMin = new Vector2(0.52f, 0);
        incrementCounterBtnRect.anchorMax = new Vector2(1, 1);
        incrementCounterBtnRect.offsetMin = Vector2.zero;
        incrementCounterBtnRect.offsetMax = Vector2.zero;
        Button incrementCounterButton = incrementCounterBtnObj.GetComponent<Button>();
        incrementCounterBtnObj.GetComponentInChildren<Text>().fontSize = 14;

        // Create MidnightBridge and wire up references
        GameObject bridgeObj = new GameObject("MidnightBridge");
        MidnightBridge bridge = bridgeObj.AddComponent<MidnightBridge>();
        bridge.statusText = statusText;
        bridge.addressText = addressText;
        bridge.connectButton = connectButton;
        bridge.connectButtonText = connectButtonText;
        bridge.copyAddressButton = copyButton;
        bridge.balanceText = balanceText;
        bridge.networkText = networkText;
        bridge.tokenListContainer = tokenListObj.transform;
        bridge.recipientInput = recipientInput;
        bridge.amountInput = amountInput;
        bridge.sendButton = sendButton;
        bridge.txStatusText = txStatusText;

        // Wire up button clicks
        connectButton.onClick.AddListener(bridge.OnConnectButtonClicked);
        copyButton.onClick.AddListener(bridge.OnCopyAddressClicked);
        sendButton.onClick.AddListener(bridge.OnSendButtonClicked);

        // Initially disable send UI until connected
        sendButton.interactable = false;
        recipientInput.interactable = false;
        amountInput.interactable = false;
        copyButton.interactable = false;

        // Create CounterReader and wire up references
        GameObject counterReaderObj = new GameObject("CounterReader");
        CounterReader counterReader = counterReaderObj.AddComponent<CounterReader>();
        counterReader.counterText = counterText;
        counterReader.counterStatusText = counterStatusText;
        counterReader.refreshButton = refreshCounterButton;
        
        // Configure counter reader with inspector values
        if (!string.IsNullOrEmpty(blockfrostProjectId))
        {
            counterReader.SetBlockfrostProjectId(blockfrostProjectId);
        }
        if (!string.IsNullOrEmpty(counterScriptAddress))
        {
            counterReader.SetScriptAddress(counterScriptAddress);
        }
        
        // Wire up refresh button
        refreshCounterButton.onClick.AddListener(counterReader.RefreshCounter);

        // Wire up increment button
        // Capture variables for lambda
        string scriptAddr = counterScriptAddress;
        string bfKey = blockfrostProjectId;
        incrementCounterButton.onClick.AddListener(() => {
            bridge.IncrementCounter(scriptAddr, bfKey);
        });

        // Auto-refresh counter after successful increment (with delay for block confirmation)
        bridge.OnCounterIncremented += (txHash) => {
            // Wait ~20 seconds for transaction to be included in a block, then refresh
            StartCoroutine(DelayedCounterRefresh(counterReader, 20f));
        };

        // Initially disable increment button until wallet connected
        incrementCounterButton.interactable = false;
        
        // Store reference to enable button when wallet connects
        Button incrementBtn = incrementCounterButton;
        
        // Use a polling approach to check connection status since MidnightBridge
        // doesn't expose a connection event directly from UI setup
        StartCoroutine(EnableIncrementButtonWhenConnected(bridge, incrementBtn));

        Debug.Log("[MidnightUISetup] UI created successfully");
    }

    private GameObject CreateInputField(Transform parent, string name, string placeholder)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Image image = obj.AddComponent<Image>();
        image.color = new Color(0.1f, 0.1f, 0.15f, 1f);

        InputField inputField = obj.AddComponent<InputField>();

        // Create text component
        GameObject textObj = new GameObject("Text");
        textObj.transform.SetParent(obj.transform, false);
        Text text = textObj.AddComponent<Text>();
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = 14;
        text.color = textColor;
        text.alignment = TextAnchor.MiddleLeft;
        text.supportRichText = false;

        RectTransform textRect = textObj.GetComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.offsetMin = new Vector2(10, 0);
        textRect.offsetMax = new Vector2(-10, 0);

        // Create placeholder
        GameObject placeholderObj = new GameObject("Placeholder");
        placeholderObj.transform.SetParent(obj.transform, false);
        Text placeholderText = placeholderObj.AddComponent<Text>();
        placeholderText.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        placeholderText.fontSize = 14;
        placeholderText.fontStyle = FontStyle.Italic;
        placeholderText.color = new Color(0.5f, 0.5f, 0.5f, 0.7f);
        placeholderText.alignment = TextAnchor.MiddleLeft;
        placeholderText.text = placeholder;

        RectTransform placeholderRect = placeholderObj.GetComponent<RectTransform>();
        placeholderRect.anchorMin = Vector2.zero;
        placeholderRect.anchorMax = Vector2.one;
        placeholderRect.offsetMin = new Vector2(10, 0);
        placeholderRect.offsetMax = new Vector2(-10, 0);

        inputField.textComponent = text;
        inputField.placeholder = placeholderText;

        return obj;
    }

    private GameObject CreatePanel(Transform parent, string name, Color color)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Image image = obj.AddComponent<Image>();
        image.color = color;

        return obj;
    }

    private GameObject CreateText(Transform parent, string name, string content, int fontSize, TextAnchor alignment)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Text text = obj.AddComponent<Text>();
        text.text = content;
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = fontSize;
        text.alignment = alignment;
        text.color = textColor;
        text.horizontalOverflow = HorizontalWrapMode.Wrap;
        text.verticalOverflow = VerticalWrapMode.Overflow;

        return obj;
    }

    private GameObject CreateButton(Transform parent, string name, string label, Color color)
    {
        GameObject obj = new GameObject(name);
        obj.transform.SetParent(parent, false);

        Image image = obj.AddComponent<Image>();
        image.color = color;

        Button button = obj.AddComponent<Button>();
        ColorBlock colors = button.colors;
        colors.normalColor = color;
        colors.highlightedColor = color * 1.1f;
        colors.pressedColor = color * 0.9f;
        colors.disabledColor = color * 0.5f;
        button.colors = colors;

        // Create button text
        GameObject textObj = new GameObject("Text");
        textObj.transform.SetParent(obj.transform, false);

        Text text = textObj.AddComponent<Text>();
        text.text = label;
        text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        text.fontSize = 20;
        text.alignment = TextAnchor.MiddleCenter;
        text.color = Color.white;

        RectTransform textRect = textObj.GetComponent<RectTransform>();
        textRect.anchorMin = Vector2.zero;
        textRect.anchorMax = Vector2.one;
        textRect.sizeDelta = Vector2.zero;

        return obj;
    }

    /// <summary>
    /// Coroutine to refresh counter after a delay (for block confirmation).
    /// </summary>
    private IEnumerator DelayedCounterRefresh(CounterReader counterReader, float delaySeconds)
    {
        Debug.Log($"[MidnightUISetup] Waiting {delaySeconds}s for block confirmation before refresh...");
        yield return new WaitForSeconds(delaySeconds);
        
        if (counterReader != null)
        {
            Debug.Log("[MidnightUISetup] Auto-refreshing counter after increment");
            counterReader.RefreshCounter();
        }
    }

    /// <summary>
    /// Coroutine to enable increment button when wallet connects.
    /// </summary>
    private IEnumerator EnableIncrementButtonWhenConnected(MidnightBridge bridge, Button incrementButton)
    {
        // Poll every second until connected
        while (bridge != null && !bridge.IsConnectedToWallet)
        {
            yield return new WaitForSeconds(1f);
        }
        
        if (incrementButton != null)
        {
            incrementButton.interactable = true;
            Debug.Log("[MidnightUISetup] Increment button enabled (wallet connected)");
        }
        
        // Continue monitoring for disconnection
        while (bridge != null)
        {
            yield return new WaitForSeconds(1f);
            if (incrementButton != null)
            {
                incrementButton.interactable = bridge.IsConnectedToWallet;
            }
        }
    }
}
