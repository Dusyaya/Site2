const express = require('express');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
const SECRET_KEY = 'your-secret-key-here';
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const GROUPS_CSV = path.join(__dirname, 'data', 'groups.csv');
const GROUPS_JSON = path.join(__dirname, 'data', 'groups.json');
const STUDENTS_FILE = path.join(__dirname, 'data', 'students.csv');
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'data', 'subscriptions.json');
const SUBSCRIPTIONS_CSV = path.join(__dirname, 'data', 'subscriptions.csv');

// Настройки Mailtrap
const transporter = nodemailer.createTransport({
    host: 'sandbox.smtp.mailtrap.io',
    port: 2525,
    auth: {
        user: '93f5ad449de6e7',
        pass: '1ee26aced06acd'
    }
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Middleware для логирования запросов
app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
});

// Функция для преобразования CSV в JSON
function convertGroupsCsvToJson() {
    return new Promise((resolve, reject) => {
        const groups = [];
        if (!fs.existsSync(GROUPS_CSV)) {
            return resolve([]);
        }

        fs.createReadStream(GROUPS_CSV)
            .pipe(csv({ separator: ';' }))
            .on('data', (row) => {
                const id = row.id || generateShortId();
                groups.push({
                    id,
                    reference: row.Ссылка?.trim() || '',
                    name: row.Наименование || '',
                    direction: row.Направление || '',
                    schedule: row.Расписание || '',
                    instructor: row.Преподаватель || '',
                    address: row.Адрес || '',
                    maxSeats: parseInt(row.МаксимальноеКоличествоМест) || 0,
                    ...row
                });
            })
            .on('end', () => {
                fs.writeFileSync(GROUPS_JSON, JSON.stringify(groups, null, 2), 'utf8');
                resolve(groups);
            })
            .on('error', reject);
    });
}

function generateShortId() {
    return Math.random().toString(36).substring(2, 10);
}

// Инициализация файлов данных
async function initializeDataFiles() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const filesToInitialize = [
        { path: USERS_FILE, content: '[]' },
        { path: SUBSCRIPTIONS_FILE, content: '[]' },
        {
            path: STUDENTS_FILE,
            content: '\uFEFFКод;Наименование;Email;Телефон\r\n'
        },
        {
            path: SUBSCRIPTIONS_CSV,
            content: 'Номер;Дата;ТипАбонемента;НаименованиеАбонемента;Преподаватель;ИмяПреподавателя;Группа;НаименованиеГруппы;Ученик;ИмяУченика;Цена;КоличествоЗанятий\r\n'
        },
        {
            path: GROUPS_CSV,
            content: 'Ссылка;Наименование;Направление;Расписание;Преподаватель;Адрес;МаксимальноеКоличествоМест\r\n'
        }
    ];

    filesToInitialize.forEach(file => {
        if (!fs.existsSync(file.path)) {
            fs.writeFileSync(file.path, file.content, 'utf8');
        }
    });

    await convertGroupsCsvToJson();
}

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Неверный токен' });
        }
        req.user = user;
        next();
    });
}

// Получение списка групп из JSON
function getGroups() {
    try {
        if (!fs.existsSync(GROUPS_JSON)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(GROUPS_JSON, 'utf8'));
    } catch (err) {
        console.error('Ошибка чтения groups.json:', err);
        return [];
    }
}

// Сохранение групп в JSON
function saveGroups(groups) {
    fs.writeFileSync(GROUPS_JSON, JSON.stringify(groups, null, 2));
}

// Получение пользователей
function getUsers() {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
        return [];
    }
}

// Сохранение пользователей
function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Получение абонементов
function getSubscriptions() {
    try {
        if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
            return [];
        }
        return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
    } catch (err) {
        console.error('Ошибка чтения subscriptions.json:', err);
        return [];
    }
}

// Сохранение абонементов
function saveSubscriptions(subscriptions) {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptions, null, 2));
}

// Генерация следующего кода студента
function getNextCode() {
    try {
        if (!fs.existsSync(STUDENTS_FILE)) return '000000001';

        const data = fs.readFileSync(STUDENTS_FILE, 'utf8');
        const lines = data.split(/\r?\n/).filter(line => line.trim() !== '');
        let maxCode = 0;

        for (const line of lines) {
            const codePart = line.split(';')[0];
            const codeNum = parseInt(codePart, 10);
            if (!isNaN(codeNum)) {
                maxCode = Math.max(maxCode, codeNum);
            }
        }

        return (maxCode + 1).toString().padStart(9, '0');
    } catch (err) {
        console.error('Ошибка при генерации кода:', err);
        return '000000001';
    }
}

// Валидация токена
app.get('/api/validate-token', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// Получение списка групп для расписания
app.get('/api/schedule', (req, res) => {
    const groups = getGroups();
    const scheduleGroups = [];

    groups.forEach(group => {
        if (group.schedule) {
            const scheduleParts = group.schedule.split(',');
            if (scheduleParts.length >= 2) {
                const days = scheduleParts[0].trim().split(/,\s*/);
                const timeRange = scheduleParts[1].trim();

                days.forEach(day => {
                    const decodedDay = decodeDayName(day);
                    if (decodedDay) {
                        scheduleGroups.push({
                            id: group.id,
                            name: group.name,
                            direction: group.direction,
                            day: decodedDay,
                            time: timeRange.split('-')[0].replace('.', ':'),
                            instructor: group.instructor,
                            address: group.address,
                            maxSeats: group.maxSeats
                        });
                    }
                });
            }
        }
    });

    res.json(scheduleGroups.filter(g => g.day));
});

function decodeDayName(dayName) {
    const dayMap = {
        'пн': 'пн', 'пон': 'пн', 'понедельник': 'пн',
        'вт': 'вт', 'вто': 'вт', 'вторник': 'вт',
        'ср': 'ср', 'сре': 'ср', 'среда': 'ср',
        'чт': 'чт', 'чет': 'чт', 'четверг': 'чт',
        'пт': 'пт', 'пят': 'пт', 'пятница': 'пт',
        'сб': 'сб', 'суб': 'сб', 'суббота': 'сб',
        'вс': 'вс', 'вос': 'вс', 'воскресенье': 'вс'
    };

    const key = dayName.toLowerCase().substring(0, 3);
    return dayMap[key];
}

// Получение списка всех групп
app.get('/api/groups', (req, res) => {
    const groups = getGroups().map(group => ({
        id: group.id,
        reference: group.reference,
        name: group.name,
        direction: group.direction,
        schedule: group.schedule,
        instructor: group.instructor,
        address: group.address,
        maxSeats: group.maxSeats
    }));
    res.json(groups);
});

// Запись в группу
app.post('/api/join-group', authenticateToken, async (req, res) => {
    const { groupId } = req.body;

    if (!groupId) {
        return res.status(400).json({ error: 'ID группы обязательно' });
    }

    try {
        const groups = getGroups();
        const groupToJoin = groups.find(g => g.id === groupId);

        if (!groupToJoin) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }

        const users = getUsers();
        const user = users.find(u => u.email === req.user.email);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!user.groups) user.groups = [];
        if (user.groups.some(g => g.id === groupId)) {
            return res.status(400).json({ error: 'Вы уже записаны в эту группу' });
        }

        if (groupToJoin.maxSeats <= 0) {
            return res.status(400).json({ error: 'В группе нет свободных мест' });
        }

        // Добавляем группу к пользователю
        user.groups.push({
            id: groupToJoin.id,
            reference: groupToJoin.reference,
            name: groupToJoin.name,
            direction: groupToJoin.direction,
            schedule: groupToJoin.schedule,
            instructor: groupToJoin.instructor,
            address: groupToJoin.address,
            maxSeats: groupToJoin.maxSeats
        });

        saveUsers(users);

        // Уменьшаем количество мест в группе
        const updatedGroups = groups.map(group => {
            if (group.id === groupId) {
                return { ...group, maxSeats: group.maxSeats - 1 };
            }
            return group;
        });

        saveGroups(updatedGroups);

        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение данных пользователя
app.get('/api/user', authenticateToken, (req, res) => {
    const users = getUsers();
    const subscriptions = getSubscriptions();
    const user = users.find(u => u.email === req.user.email);

    if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
    }

    const userGroupsWithSubscriptions = user.groups?.map(group => {
        const groupSubscriptions = subscriptions.filter(s =>
            s.userId === user.id && s.groupId === group.id && s.status === 'active'
        );

        const remainingClasses = groupSubscriptions.reduce(
            (sum, sub) => sum + (sub.remaining || 0), 0
        );

        return {
            ...group,
            remainingClasses
        };
    }) || [];

    const { password, ...userData } = user;

    res.json({
        ...userData,
        groups: userGroupsWithSubscriptions,
        subscriptions: subscriptions.filter(s => s.userId === user.id),
        token: jwt.sign({ email: user.email }, SECRET_KEY, { expiresIn: '1h' })
    });
});

// Регистрация
app.post('/register', async (req, res) => {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    const users = getUsers();

    if (users.some(u => u.email === email)) {
        return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    if (users.some(u => u.phone === phone)) {
        return res.status(400).json({ error: 'Пользователь с таким телефоном уже существует' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: Date.now().toString(),
            name,
            email,
            phone,
            password: hashedPassword,
            groups: [],
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        saveUsers(users);

        // Запись в CSV студентов
        const code = getNextCode();
        const row = `${code};${name};${email};${phone}\r\n`;
        fs.appendFileSync(STUDENTS_FILE, row, 'utf8');

        const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: '1h' });

        res.json({
            success: true,
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                phone: newUser.phone
            }
        });

    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const users = getUsers();
    const user = users.find(u => u.email === email);

    if (!user) {
        return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    try {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const token = jwt.sign({ email }, SECRET_KEY, { expiresIn: '1h' });
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone
            }
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Покупка абонемента
app.post('/api/subscribe', authenticateToken, async (req, res) => {
    const { subscriptionType: type, groupId } = req.body;

    if (!type || !groupId) {
        return res.status(400).json({ error: 'Тип абонемента и ID группы обязательны' });
    }

    if (!["8", "4", "1"].includes(type)) {
        return res.status(400).json({ error: 'Неверный тип абонемента' });
    }

    try {
        const groups = getGroups();
        const group = groups.find(g => g.id === groupId);

        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }

        const users = getUsers();
        const user = users.find(u => u.email === req.user.email);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!user.groups || !user.groups.some(g => g.id === groupId)) {
            return res.status(400).json({ error: 'Вы не записаны в эту группу' });
        }

        let price, durationDays, classes, subscriptionName;
        switch (type) {
            case '8':
                price = 5000;
                durationDays = 28;
                classes = 8;
                subscriptionName = '8 занятий';
                break;
            case '4':
                price = 3000;
                durationDays = 28;
                classes = 4;
                subscriptionName = '4 занятия';
                break;
            case '1':
                price = 800;
                durationDays = 7;
                classes = 1;
                subscriptionName = 'Разовое занятие';
                break;
            default:
                return res.status(400).json({ error: 'Неверный тип абонемента' });
        }

        const purchaseDate = new Date();
        const expiryDate = new Date();
        expiryDate.setDate(purchaseDate.getDate() + durationDays);

        const formattedDate = purchaseDate.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        }).replace(/\./g, '.');

        const subscriptions = getSubscriptions();
        const subscriptionNumber = (subscriptions.length + 1).toString().padStart(9, '0');

        const newSubscription = {
            id: Date.now().toString(),
            userId: user.id,
            type,
            price,
            purchaseDate: purchaseDate.toISOString(),
            expiryDate: expiryDate.toISOString(),
            remaining: classes,
            status: 'active',
            groupId,
            subscriptionNumber,
            formattedDate,
            subscriptionName,
            groupName: group.name,
            teacher: group.instructor,
            userName: user.name
        };

        subscriptions.push(newSubscription);
        saveSubscriptions(subscriptions);

        const csvRow = [
            subscriptionNumber,
            formattedDate,
            type === '1' ? 'Разовое занятие' : `${classes} занятий`,
            subscriptionName,
            group.instructor,
            group.instructor,
            groupId,
            group.name,
            user.id,
            user.name,
            price.toLocaleString('ru-RU', { minimumFractionDigits: 2 }).replace(',', ' '),
            classes
        ].join(';') + '\r\n';

        fs.appendFileSync(SUBSCRIPTIONS_CSV, csvRow, 'utf8');

        const mailOptions = {
            from: '"Школа Танца" <no-reply@dance-school.ru>',
            to: user.email,
            subject: `Покупка абонемента на ${classes} занятий`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #A1004F;">Спасибо за покупку абонемента!</h2>
                    <p>Здравствуйте, ${user.name}!</p>
                    <p>Вы успешно приобрели абонемент на ${classes} занятий в группу "${group.name}".</p>
                    
                    <div style="background: #FAF4FF; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <p><strong>Тип абонемента:</strong> ${classes} занятий</p>
                        <p><strong>Группа:</strong> ${group.name}</p>
                        <p><strong>Преподаватель:</strong> ${group.instructor}</p>
                        <p><strong>Сумма:</strong> ${price} руб.</p>
                        <p><strong>Дата покупки:</strong> ${purchaseDate.toLocaleDateString('ru-RU')}</p>
                        <p><strong>Действителен до:</strong> ${expiryDate.toLocaleDateString('ru-RU')}</p>
                    </div>
                    
                    <p>Ждем вас на занятиях!</p>
                    <p style="color: #777; font-size: 12px;">
                        Это письмо сформировано автоматически, пожалуйста, не отвечайте на него.
                    </p>
                </div>
            `
        };

        transporter.sendMail(mailOptions);

        res.json({
            success: true,
            message: 'Абонемент успешно приобретен',
            subscription: newSubscription
        });

    } catch (error) {
        console.error('Ошибка покупки абонемента:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отметка посещения занятия
app.post('/api/mark-attendance', authenticateToken, async (req, res) => {
    const { groupId } = req.body;

    if (!groupId) {
        return res.status(400).json({ error: 'ID группы обязательно' });
    }

    try {
        const users = getUsers();
        const user = users.find(u => u.email === req.user.email);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (!user.groups || !user.groups.some(g => g.id === groupId)) {
            return res.status(400).json({ error: 'Вы не записаны в эту группу' });
        }

        const subscriptions = getSubscriptions();
        const activeSubs = subscriptions.filter(s =>
            s.userId === user.id &&
            s.groupId === groupId &&
            s.status === 'active' &&
            new Date(s.expiryDate) > new Date() &&
            s.remaining > 0
        );

        if (activeSubs.length === 0) {
            return res.status(400).json({ error: 'Нет активных абонементов' });
        }

        const subscription = activeSubs[0];
        subscription.remaining -= 1;

        if (subscription.remaining <= 0) {
            subscription.status = 'used';
        }

        saveSubscriptions(subscriptions);

        res.json({
            success: true,
            message: 'Занятие отмечено',
            remaining: subscription.remaining,
            subscriptionId: subscription.id
        });

    } catch (error) {
        console.error('Ошибка отметки посещения:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обработка формы контактов
app.post('/submit-contact', (req, res) => {
    const { name, email, phone, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Имя, email и сообщение обязательны для заполнения' });
    }

    const mailOptions = {
        from: '"Школа Танца" <no-reply@dance-school.ru>',
        to: 'shokoladpailsin@gmail.com',
        subject: `Новый вопрос от ${name}`,
        text: `
            Имя: ${name}
            Email: ${email}
            Телефон: ${phone || 'не указан'}
            Сообщение: ${message}
        `,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #A1004F;">Новый вопрос от ${name}</h2>
                <p><strong>Email:</strong> ${email}</p>
                ${phone ? `<p><strong>Телефон:</strong> ${phone}</p>` : ''}
                <p><strong>Сообщение:</strong></p>
                <div style="background: #FAF4FF; padding: 15px; border-radius: 8px; margin-top: 10px;">
                    ${message.replace(/\n/g, '<br>')}
                </div>
                <p style="margin-top: 20px; color: #777; font-size: 12px;">
                    Это сообщение отправлено с сайта Школы Танца
                </p>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('Ошибка отправки:', error);
            return res.status(500).json({ error: 'Не удалось отправить сообщение' });
        }
        res.json({ success: true, message: 'Ваш вопрос отправлен!' });
    });
});

// Экспорт данных студентов
app.get('/export-students', (req, res) => {
    try {
        if (!fs.existsSync(STUDENTS_FILE)) {
            return res.status(404).json({ error: 'Файл данных не найден' });
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=students.csv');

        const fileStream = fs.createReadStream(STUDENTS_FILE);
        fileStream.pipe(res);
    } catch (error) {
        console.error('Ошибка экспорта:', error);
        res.status(500).json({ error: 'Ошибка сервера при экспорте данных' });
    }
});

// Инициализация при запуске
initializeDataFiles().then(() => {
    console.log('Инициализация данных завершена');
});

// Запуск сервера
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});