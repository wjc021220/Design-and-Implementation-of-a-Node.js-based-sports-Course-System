-- 体育选课系统完整数据库脚本
-- 整合了学生端、教师端、管理员端所有功能
-- 创建时间：2025-09-22
-- 更新时间：2025-09-25（添加紧急处理功能相关表）

-- 删除并重新创建数据库（确保干净的环境）
DROP DATABASE IF EXISTS sports_course_system;
CREATE DATABASE sports_course_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sports_course_system;

-- ================================
-- 基础表结构
-- ================================

-- 用户表（学生+教师统一管理）
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id VARCHAR(20) NULL COMMENT '学号（学生用）',
    username VARCHAR(50) NOT NULL COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码（加密）',
    user_type ENUM('student', 'teacher', 'admin') DEFAULT 'student' COMMENT '用户类型',
    teacher_id INT NULL COMMENT '关联教师ID',
    real_name VARCHAR(50) NOT NULL COMMENT '真实姓名',
    gender ENUM('male', 'female') DEFAULT NULL COMMENT '性别',
    email VARCHAR(100) COMMENT '邮箱',
    phone VARCHAR(20) COMMENT '手机号',
    grade VARCHAR(10) COMMENT '年级',
    major VARCHAR(100) COMMENT '专业',
    class_name VARCHAR(50) COMMENT '班级',
    credit_limit INT DEFAULT 4 COMMENT '学分上限',
    status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_student_id (student_id),
    UNIQUE KEY unique_username (username)
) COMMENT '用户表';

-- 教师表
CREATE TABLE IF NOT EXISTS teachers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    teacher_id VARCHAR(20) UNIQUE COMMENT '教师工号（兼容旧数据）',
    employee_id VARCHAR(20) UNIQUE NOT NULL COMMENT '教师工号',
    name VARCHAR(50) NOT NULL COMMENT '教师姓名',
    title VARCHAR(50) COMMENT '职称',
    department VARCHAR(100) COMMENT '所属院系',
    phone VARCHAR(20) COMMENT '联系电话',
    email VARCHAR(100) COMMENT '邮箱',
    specialties TEXT COMMENT '专业特长',
    bio TEXT COMMENT '个人简介',
    introduction TEXT COMMENT '教师简介（兼容旧字段）',
    status ENUM('active', 'inactive', 'suspended') DEFAULT 'active' COMMENT '状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_employee_id (employee_id),
    INDEX idx_department (department),
    INDEX idx_status (status)
) COMMENT '教师表';

-- 添加外键约束
ALTER TABLE users ADD FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;

-- 场地表
CREATE TABLE IF NOT EXISTS venues (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL COMMENT '场地名称',
    type VARCHAR(50) COMMENT '场地类型',
    location VARCHAR(200) COMMENT '场地位置',
    capacity INT COMMENT '容纳人数',
    description TEXT COMMENT '场地描述',
    equipment TEXT COMMENT '设备描述',
    status ENUM('available', 'maintenance', 'unavailable') DEFAULT 'available' COMMENT '场地状态',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_status (status)
) COMMENT '场地表';

-- 体育类别表
CREATE TABLE IF NOT EXISTS sport_categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL COMMENT '类别名称',
    description TEXT COMMENT '类别描述',
    icon VARCHAR(100) COMMENT '图标路径',
    sort_order INT DEFAULT 0 COMMENT '排序',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) COMMENT '体育类别表';

-- 课程表
CREATE TABLE IF NOT EXISTS courses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    course_code VARCHAR(20) UNIQUE NOT NULL COMMENT '课程代码',
    name VARCHAR(100) NOT NULL COMMENT '课程名称',
    category_id INT NOT NULL COMMENT '体育类别ID',
    teacher_id INT NOT NULL COMMENT '教师ID',
    venue_id INT NOT NULL COMMENT '场地ID',
    credits INT DEFAULT 2 COMMENT '学分',
    capacity INT NOT NULL COMMENT '课程容量',
    enrolled_count INT DEFAULT 0 COMMENT '已选人数',
    day_of_week TINYINT NOT NULL COMMENT '星期几（1-7）',
    start_time TIME NOT NULL COMMENT '开始时间',
    end_time TIME NOT NULL COMMENT '结束时间',
    weeks VARCHAR(100) COMMENT '上课周次（如：1-16周）',
    semester VARCHAR(20) COMMENT '学期（如：2025春）',
    academic_year VARCHAR(10) COMMENT '学年（如：2024-2025）',
    syllabus TEXT COMMENT '教学大纲',
    assessment_method TEXT COMMENT '考核方式',
    requirements TEXT COMMENT '选课要求',
    description TEXT COMMENT '课程描述',
    status ENUM('draft', 'published', 'closed') DEFAULT 'draft' COMMENT '课程状态',
    selection_start_time TIMESTAMP COMMENT '选课开始时间',
    selection_end_time TIMESTAMP COMMENT '选课结束时间',
    grade_restriction VARCHAR(100) DEFAULT NULL COMMENT '年级限制',
    gender_restriction ENUM('all', 'male', 'female') DEFAULT 'all' COMMENT '性别限制',
    prerequisites TEXT COMMENT '选课前置条件',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES sport_categories(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id),
    FOREIGN KEY (venue_id) REFERENCES venues(id)
) COMMENT '课程表';

-- ================================
-- 学生端功能表
-- ================================

-- 选课记录表
CREATE TABLE IF NOT EXISTS course_selections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '学生ID',
    course_id INT NOT NULL COMMENT '课程ID',
    status ENUM('pending', 'selected', 'lottery', 'failed', 'dropped', 'waiting') DEFAULT 'pending' COMMENT '选课状态',
    priority INT DEFAULT 1 COMMENT '选课优先级',
    selection_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '选课时间',
    selected_at TIMESTAMP NULL COMMENT '选中时间',
    result_time TIMESTAMP NULL COMMENT '结果确定时间',
    remarks TEXT COMMENT '备注',
    admin_notes TEXT COMMENT '管理员备注',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_course (user_id, course_id)
) COMMENT '选课记录表';

-- 收藏课程表
CREATE TABLE IF NOT EXISTS course_favorites (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '学生ID',
    course_id INT NOT NULL COMMENT '课程ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_course_favorite (user_id, course_id)
) COMMENT '收藏课程表';

-- 选课历史表
CREATE TABLE IF NOT EXISTS selection_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL COMMENT '学生ID',
    course_id INT NOT NULL COMMENT '课程ID',
    action ENUM('select', 'drop', 'lottery_win', 'lottery_lose') NOT NULL COMMENT '操作类型',
    semester VARCHAR(20) COMMENT '学期',
    academic_year VARCHAR(10) COMMENT '学年',
    action_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
    remarks TEXT COMMENT '备注',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) COMMENT '选课历史表';

-- ================================
-- 教师端功能表
-- ================================

-- 成绩表（旧版，已废弃，仅保留兼容性）
CREATE TABLE IF NOT EXISTS grades (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id INT NOT NULL COMMENT '学生ID',
    course_id INT NOT NULL COMMENT '课程ID',
    teacher_id INT NOT NULL COMMENT '教师ID',
    attendance_score DECIMAL(5,2) DEFAULT 0 COMMENT '平时表现分数',
    final_score DECIMAL(5,2) DEFAULT 0 COMMENT '期末考核分数',
    total_score DECIMAL(5,2) DEFAULT 0 COMMENT '总分',
    grade_level VARCHAR(10) DEFAULT NULL COMMENT '等级(优秀/良好/及格/不及格)',
    remarks TEXT COMMENT '备注',
    submitted_at TIMESTAMP NULL COMMENT '提交时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_course (student_id, course_id)
) COMMENT '成绩表';

-- 学生成绩表（新版，支持更详细的成绩记录）
CREATE TABLE IF NOT EXISTS student_grades (
    id INT PRIMARY KEY AUTO_INCREMENT,
    course_id INT NOT NULL COMMENT '课程ID',
    student_id INT NOT NULL COMMENT '学生ID',
    attendance_score DECIMAL(5,2) DEFAULT NULL COMMENT '出勤分数(0-100)',
    performance_score DECIMAL(5,2) DEFAULT NULL COMMENT '平时表现分数(0-100)',
    midterm_score DECIMAL(5,2) DEFAULT NULL COMMENT '期中分数(0-100)',
    final_score DECIMAL(5,2) DEFAULT NULL COMMENT '期末分数(0-100)',
    total_score DECIMAL(5,2) DEFAULT NULL COMMENT '总分(0-100)',
    grade_level CHAR(1) DEFAULT NULL COMMENT '等级(A/B/C/D/F)',
    semester VARCHAR(20) NOT NULL COMMENT '学期(如：2025春)',
    academic_year VARCHAR(10) NOT NULL COMMENT '学年(如：2024-2025)',
    is_submitted BOOLEAN DEFAULT FALSE COMMENT '是否已提交到教务系统',
    submit_time TIMESTAMP NULL COMMENT '提交时间',
    remarks TEXT COMMENT '备注',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_course_semester (student_id, course_id, semester, academic_year),
    INDEX idx_course_id (course_id),
    INDEX idx_student_id (student_id),
    INDEX idx_semester_year (semester, academic_year),
    INDEX idx_is_submitted (is_submitted)
) COMMENT '学生成绩表';

-- 课程文件表
CREATE TABLE IF NOT EXISTS course_files (
    id INT PRIMARY KEY AUTO_INCREMENT,
    course_id INT NOT NULL COMMENT '课程ID',
    file_name VARCHAR(255) NOT NULL COMMENT '文件名',
    file_path VARCHAR(500) NOT NULL COMMENT '文件路径',
    file_type ENUM('syllabus', 'assessment', 'material', 'other') NOT NULL COMMENT '文件类型',
    file_size INT COMMENT '文件大小（字节）',
    mime_type VARCHAR(100) COMMENT 'MIME类型',
    uploaded_by INT NOT NULL COMMENT '上传者（用户ID）',
    description TEXT COMMENT '文件描述',
    is_public BOOLEAN DEFAULT FALSE COMMENT '是否对学生公开',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
) COMMENT '课程文件表';

-- 特殊申请表
CREATE TABLE IF NOT EXISTS special_applications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id INT NOT NULL COMMENT '学生ID',
    course_id INT NOT NULL COMMENT '原课程ID',
    request_type ENUM('injury', 'medical', 'transfer', 'other') NOT NULL COMMENT '申请类型',
    reason TEXT NOT NULL COMMENT '申请原因',
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending' COMMENT '申请状态',
    teacher_id INT NULL COMMENT '处理教师',
    teacher_comment TEXT COMMENT '教师处理意见',
    processed_at TIMESTAMP NULL COMMENT '处理时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
) COMMENT '特殊申请表';

-- 课程公告表
CREATE TABLE IF NOT EXISTS course_announcements (
    id INT PRIMARY KEY AUTO_INCREMENT,
    course_id INT NOT NULL COMMENT '课程ID',
    teacher_id INT NOT NULL COMMENT '发布教师ID',
    title VARCHAR(200) NOT NULL COMMENT '公告标题',
    content TEXT NOT NULL COMMENT '公告内容',
    is_important BOOLEAN DEFAULT FALSE COMMENT '是否重要',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
) COMMENT '课程公告表';

-- 考勤记录表
CREATE TABLE IF NOT EXISTS attendance_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    student_id INT NOT NULL COMMENT '学生ID',
    course_id INT NOT NULL COMMENT '课程ID',
    class_date DATE NOT NULL COMMENT '上课日期',
    status ENUM('present', 'absent', 'late', 'leave') NOT NULL COMMENT '考勤状态',
    notes TEXT COMMENT '备注',
    recorded_by INT NOT NULL COMMENT '记录者（教师用户ID）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_student_course_date (student_id, course_id, class_date)
) COMMENT '考勤记录表';

-- ================================
-- 管理员端功能表
-- ================================

-- 管理员用户表
CREATE TABLE IF NOT EXISTS admin_users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名',
    password VARCHAR(255) NOT NULL COMMENT '密码',
    real_name VARCHAR(50) NOT NULL COMMENT '真实姓名',
    email VARCHAR(100) COMMENT '邮箱',
    phone VARCHAR(20) COMMENT '手机号',
    role ENUM('super_admin', 'admin', 'operator') DEFAULT 'operator' COMMENT '角色',
    permissions JSON COMMENT '权限配置',
    status ENUM('active', 'inactive') DEFAULT 'active' COMMENT '状态',
    last_login TIMESTAMP NULL COMMENT '最后登录时间',
    login_ip VARCHAR(45) COMMENT '登录IP',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT '管理员用户表';

-- 选课配置表
CREATE TABLE IF NOT EXISTS course_selection_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    semester VARCHAR(20) NOT NULL COMMENT '学期',
    academic_year VARCHAR(10) NOT NULL COMMENT '学年',
    round_number INT NOT NULL COMMENT '轮次',
    round_name VARCHAR(50) NOT NULL COMMENT '轮次名称',
    selection_method ENUM('first_come', 'lottery', 'priority') NOT NULL COMMENT '选课方式',
    start_time TIMESTAMP NOT NULL COMMENT '开始时间',
    end_time TIMESTAMP NOT NULL COMMENT '结束时间',
    max_credits INT DEFAULT 4 COMMENT '最大学分',
    max_courses INT DEFAULT 2 COMMENT '最大课程数',
    allow_drop BOOLEAN DEFAULT TRUE COMMENT '是否允许退课',
    allow_change BOOLEAN DEFAULT TRUE COMMENT '是否允许改选',
    priority_rules JSON COMMENT '优先级规则',
    lottery_config JSON COMMENT '抽签配置',
    description TEXT COMMENT '配置描述',
    status ENUM('draft', 'active', 'ended', 'cancelled') DEFAULT 'draft' COMMENT '配置状态',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否激活',
    created_by INT NOT NULL COMMENT '创建者',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admin_users(id),
    INDEX idx_semester_year (semester, academic_year),
    INDEX idx_status (status),
    INDEX idx_time (start_time, end_time)
) COMMENT '选课配置表';

-- 系统配置表
CREATE TABLE IF NOT EXISTS system_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    config_key VARCHAR(100) UNIQUE NOT NULL COMMENT '配置键',
    config_value TEXT COMMENT '配置值',
    config_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string' COMMENT '配置类型',
    category VARCHAR(50) DEFAULT 'general' COMMENT '配置分类',
    description TEXT COMMENT '配置描述',
    is_public BOOLEAN DEFAULT FALSE COMMENT '是否公开',
    updated_by INT COMMENT '更新者ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_updated_by (updated_by)
) COMMENT '系统配置表';

-- 场地时间表
CREATE TABLE IF NOT EXISTS venue_schedules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    venue_id INT NOT NULL COMMENT '场地ID',
    day_of_week TINYINT NOT NULL COMMENT '星期几(1-7)',
    start_time TIME NOT NULL COMMENT '开始时间',
    end_time TIME NOT NULL COMMENT '结束时间',
    is_available BOOLEAN DEFAULT TRUE COMMENT '是否可用',
    maintenance_reason TEXT COMMENT '维护原因',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
    INDEX idx_venue_day (venue_id, day_of_week),
    INDEX idx_time (start_time, end_time)
) COMMENT '场地时间表';

-- 教师资质表
CREATE TABLE IF NOT EXISTS teacher_qualifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    teacher_id INT NOT NULL COMMENT '教师ID',
    sport_category VARCHAR(50) NOT NULL COMMENT '体育类别',
    qualification_level ENUM('国家级', '省级', '市级', '校级', '其他') DEFAULT '其他' COMMENT '资质等级',
    certificate_name VARCHAR(100) COMMENT '证书名称',
    certificate_number VARCHAR(100) COMMENT '证书编号',
    issue_date DATE COMMENT '颁发日期',
    expire_date DATE COMMENT '过期日期',
    issuing_authority VARCHAR(100) COMMENT '颁发机构',
    description TEXT COMMENT '资质描述',
    attachment_url VARCHAR(500) COMMENT '附件URL',
    verified_status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending' COMMENT '验证状态',
    verified_by INT COMMENT '验证人ID',
    verified_at TIMESTAMP NULL COMMENT '验证时间',
    verification_notes TEXT COMMENT '验证备注',
    training_hours INT DEFAULT 0 COMMENT '培训学时',
    training_institution VARCHAR(200) COMMENT '培训机构',
    is_active BOOLEAN DEFAULT TRUE COMMENT '是否有效',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_teacher_id (teacher_id),
    INDEX idx_sport_category (sport_category),
    INDEX idx_qualification_level (qualification_level),
    INDEX idx_verified_status (verified_status)
) COMMENT '教师资质表';

-- 教师资质申请记录表
CREATE TABLE IF NOT EXISTS teacher_qualification_applications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    teacher_id INT NOT NULL COMMENT '教师ID',
    sport_category VARCHAR(50) NOT NULL COMMENT '体育类别',
    qualification_level ENUM('国家级', '省级', '市级', '校级', '其他') DEFAULT '其他' COMMENT '资质等级',
    certificate_name VARCHAR(100) NOT NULL COMMENT '证书名称',
    certificate_number VARCHAR(100) COMMENT '证书编号',
    issue_date DATE COMMENT '颁发日期',
    expire_date DATE COMMENT '过期日期',
    issuing_authority VARCHAR(100) COMMENT '颁发机构',
    description TEXT COMMENT '资质描述',
    attachment_url VARCHAR(500) COMMENT '附件URL',
    application_status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending' COMMENT '申请状态',
    application_reason TEXT COMMENT '申请理由',
    review_notes TEXT COMMENT '审核备注',
    reviewed_by INT COMMENT '审核人ID',
    reviewed_at TIMESTAMP NULL COMMENT '审核时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_teacher_id (teacher_id),
    INDEX idx_application_status (application_status),
    INDEX idx_created_at (created_at)
) COMMENT '教师资质申请表';

-- 教师培训记录表
CREATE TABLE IF NOT EXISTS teacher_training_records (
    id INT PRIMARY KEY AUTO_INCREMENT,
    teacher_id INT NOT NULL COMMENT '教师ID',
    training_name VARCHAR(200) NOT NULL COMMENT '培训名称',
    training_type ENUM('岗前培训', '专业培训', '继续教育', '技能培训', '其他') DEFAULT '其他' COMMENT '培训类型',
    training_institution VARCHAR(200) COMMENT '培训机构',
    training_start_date DATE COMMENT '培训开始日期',
    training_end_date DATE COMMENT '培训结束日期',
    training_hours INT DEFAULT 0 COMMENT '培训学时',
    certificate_obtained BOOLEAN DEFAULT FALSE COMMENT '是否获得证书',
    certificate_name VARCHAR(100) COMMENT '证书名称',
    certificate_number VARCHAR(100) COMMENT '证书编号',
    training_content TEXT COMMENT '培训内容',
    training_result ENUM('优秀', '良好', '合格', '不合格', '进行中') DEFAULT '进行中' COMMENT '培训结果',
    attachment_url VARCHAR(500) COMMENT '附件URL',
    notes TEXT COMMENT '备注',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
    INDEX idx_teacher_id (teacher_id),
    INDEX idx_training_type (training_type),
    INDEX idx_training_date (training_start_date, training_end_date)
) COMMENT '教师培训记录表';

-- 资质评审记录表
CREATE TABLE IF NOT EXISTS qualification_review_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    qualification_id INT COMMENT '资质ID',
    application_id INT COMMENT '申请ID',
    review_type ENUM('initial', 'renewal', 'audit', 'complaint') DEFAULT 'initial' COMMENT '评审类型',
    reviewer_id INT NOT NULL COMMENT '评审人ID',
    review_result ENUM('pass', 'fail', 'pending', 'need_supplement') DEFAULT 'pending' COMMENT '评审结果',
    review_score INT COMMENT '评审分数',
    review_comments TEXT COMMENT '评审意见',
    review_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '评审时间',
    FOREIGN KEY (qualification_id) REFERENCES teacher_qualifications(id) ON DELETE CASCADE,
    FOREIGN KEY (application_id) REFERENCES teacher_qualification_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES admin_users(id) ON DELETE CASCADE,
    INDEX idx_qualification_id (qualification_id),
    INDEX idx_application_id (application_id),
    INDEX idx_review_date (review_date)
) COMMENT '资质评审记录表';

-- ================================
-- 创建索引
-- ================================

-- 基础表索引
CREATE INDEX idx_users_type ON users(user_type);
CREATE INDEX idx_users_teacher ON users(teacher_id);
CREATE INDEX idx_courses_category ON courses(category_id);
CREATE INDEX idx_courses_teacher ON courses(teacher_id);
CREATE INDEX idx_courses_venue ON courses(venue_id);
CREATE INDEX idx_courses_time ON courses(day_of_week, start_time, end_time);

-- 学生端索引
CREATE INDEX idx_selections_user ON course_selections(user_id);
CREATE INDEX idx_selections_course ON course_selections(course_id);
CREATE INDEX idx_selections_status ON course_selections(status);
CREATE INDEX idx_favorites_user ON course_favorites(user_id);
CREATE INDEX idx_history_user ON selection_history(user_id);

-- 教师端索引
CREATE INDEX idx_grades_student ON grades(student_id);
CREATE INDEX idx_grades_course ON grades(course_id);
CREATE INDEX idx_grades_teacher ON grades(teacher_id);
CREATE INDEX idx_course_files_course ON course_files(course_id);
CREATE INDEX idx_special_applications_student ON special_applications(student_id);
CREATE INDEX idx_announcements_course ON course_announcements(course_id);
CREATE INDEX idx_attendance_course_date ON attendance_records(course_id, class_date);

-- ================================
-- 插入初始数据
-- ================================

-- 插入体育类别
INSERT IGNORE INTO sport_categories (name, description, icon, sort_order) VALUES
('球类运动', '包括篮球、足球、排球、乒乓球、羽毛球、网球等', 'ball.png', 1),
('田径运动', '包括跑步、跳跃、投掷等项目', 'track.png', 2),
('武术运动', '包括太极拳、散打、剑术等传统武术', 'martial.png', 3),
('游泳运动', '游泳技能训练和水上运动', 'swimming.png', 4),
('健身运动', '包括健美操、瑜伽、普拉提等', 'fitness.png', 5),
('户外运动', '包括登山、定向越野等户外活动', 'outdoor.png', 6);

-- 插入场地信息
INSERT IGNORE INTO venues (name, type, location, capacity, equipment, status) VALUES
('体育馆篮球场1', 'indoor', '体育馆一层东侧', 40, '标准篮球架、计分板', 'available'),
('体育馆篮球场2', 'indoor', '体育馆一层西侧', 40, '标准篮球架、计分板', 'available'),
('足球场', 'outdoor', '体育场中央', 60, '标准足球门、草坪', 'available'),
('网球场1', 'outdoor', '体育馆外东侧', 20, '标准网球网、硬地场地', 'available'),
('网球场2', 'outdoor', '体育馆外西侧', 20, '标准网球网、硬地场地', 'available'),
('游泳馆', 'swimming', '体育馆二层', 30, '标准泳池、救生设备', 'available'),
('武术馆', 'indoor', '体育馆三层', 50, '镜面墙、武术器械', 'available'),
('健身房', 'gym', '体育馆四层', 35, '各类健身器材、音响设备', 'available');

-- 插入场地时间表（开放时间）
-- 室内场馆（篮球场、武术馆、健身房）开放时间：周一到周日 8:00-22:00
INSERT IGNORE INTO venue_schedules (venue_id, day_of_week, start_time, end_time, is_available) VALUES
-- 篮球场1
(1, 1, '08:00:00', '12:00:00', 1), (1, 1, '14:00:00', '18:00:00', 1), (1, 1, '19:00:00', '22:00:00', 1),
(1, 2, '08:00:00', '12:00:00', 1), (1, 2, '14:00:00', '18:00:00', 1), (1, 2, '19:00:00', '22:00:00', 1),
(1, 3, '08:00:00', '12:00:00', 1), (1, 3, '14:00:00', '18:00:00', 1), (1, 3, '19:00:00', '22:00:00', 1),
(1, 4, '08:00:00', '12:00:00', 1), (1, 4, '14:00:00', '18:00:00', 1), (1, 4, '19:00:00', '22:00:00', 1),
(1, 5, '08:00:00', '12:00:00', 1), (1, 5, '14:00:00', '18:00:00', 1), (1, 5, '19:00:00', '22:00:00', 1),
(1, 6, '08:00:00', '12:00:00', 1), (1, 6, '14:00:00', '18:00:00', 1), (1, 6, '19:00:00', '22:00:00', 1),
(1, 7, '08:00:00', '12:00:00', 1), (1, 7, '14:00:00', '18:00:00', 1), (1, 7, '19:00:00', '22:00:00', 1),

-- 篮球场2
(2, 1, '08:00:00', '12:00:00', 1), (2, 1, '14:00:00', '18:00:00', 1), (2, 1, '19:00:00', '22:00:00', 1),
(2, 2, '08:00:00', '12:00:00', 1), (2, 2, '14:00:00', '18:00:00', 1), (2, 2, '19:00:00', '22:00:00', 1),
(2, 3, '08:00:00', '12:00:00', 1), (2, 3, '14:00:00', '18:00:00', 1), (2, 3, '19:00:00', '22:00:00', 1),
(2, 4, '08:00:00', '12:00:00', 1), (2, 4, '14:00:00', '18:00:00', 1), (2, 4, '19:00:00', '22:00:00', 1),
(2, 5, '08:00:00', '12:00:00', 1), (2, 5, '14:00:00', '18:00:00', 1), (2, 5, '19:00:00', '22:00:00', 1),
(2, 6, '08:00:00', '12:00:00', 1), (2, 6, '14:00:00', '18:00:00', 1), (2, 6, '19:00:00', '22:00:00', 1),
(2, 7, '08:00:00', '12:00:00', 1), (2, 7, '14:00:00', '18:00:00', 1), (2, 7, '19:00:00', '22:00:00', 1),

-- 足球场（户外，开放时间相对较长）
(3, 1, '06:00:00', '12:00:00', 1), (3, 1, '14:00:00', '20:00:00', 1),
(3, 2, '06:00:00', '12:00:00', 1), (3, 2, '14:00:00', '20:00:00', 1),
(3, 3, '06:00:00', '12:00:00', 1), (3, 3, '14:00:00', '20:00:00', 1),
(3, 4, '06:00:00', '12:00:00', 1), (3, 4, '14:00:00', '20:00:00', 1),
(3, 5, '06:00:00', '12:00:00', 1), (3, 5, '14:00:00', '20:00:00', 1),
(3, 6, '06:00:00', '12:00:00', 1), (3, 6, '14:00:00', '20:00:00', 1),
(3, 7, '06:00:00', '12:00:00', 1), (3, 7, '14:00:00', '20:00:00', 1),

-- 网球场1和网球场2
(4, 1, '07:00:00', '11:00:00', 1), (4, 1, '15:00:00', '19:00:00', 1),
(4, 2, '07:00:00', '11:00:00', 1), (4, 2, '15:00:00', '19:00:00', 1),
(4, 3, '07:00:00', '11:00:00', 1), (4, 3, '15:00:00', '19:00:00', 1),
(4, 4, '07:00:00', '11:00:00', 1), (4, 4, '15:00:00', '19:00:00', 1),
(4, 5, '07:00:00', '11:00:00', 1), (4, 5, '15:00:00', '19:00:00', 1),
(4, 6, '07:00:00', '11:00:00', 1), (4, 6, '15:00:00', '19:00:00', 1),
(4, 7, '07:00:00', '11:00:00', 1), (4, 7, '15:00:00', '19:00:00', 1),

(5, 1, '07:00:00', '11:00:00', 1), (5, 1, '15:00:00', '19:00:00', 1),
(5, 2, '07:00:00', '11:00:00', 1), (5, 2, '15:00:00', '19:00:00', 1),
(5, 3, '07:00:00', '11:00:00', 1), (5, 3, '15:00:00', '19:00:00', 1),
(5, 4, '07:00:00', '11:00:00', 1), (5, 4, '15:00:00', '19:00:00', 1),
(5, 5, '07:00:00', '11:00:00', 1), (5, 5, '15:00:00', '19:00:00', 1),
(5, 6, '07:00:00', '11:00:00', 1), (5, 6, '15:00:00', '19:00:00', 1),
(5, 7, '07:00:00', '11:00:00', 1), (5, 7, '15:00:00', '19:00:00', 1),

-- 游泳馆（特殊时间安排，中午休息）
(6, 1, '06:30:00', '11:30:00', 1), (6, 1, '14:30:00', '21:30:00', 1),
(6, 2, '06:30:00', '11:30:00', 1), (6, 2, '14:30:00', '21:30:00', 1),
(6, 3, '06:30:00', '11:30:00', 1), (6, 3, '14:30:00', '21:30:00', 1),
(6, 4, '06:30:00', '11:30:00', 1), (6, 4, '14:30:00', '21:30:00', 1),
(6, 5, '06:30:00', '11:30:00', 1), (6, 5, '14:30:00', '21:30:00', 1),
(6, 6, '06:30:00', '11:30:00', 1), (6, 6, '14:30:00', '21:30:00', 1),
(6, 7, '06:30:00', '11:30:00', 1), (6, 7, '14:30:00', '21:30:00', 1),

-- 武术馆
(7, 1, '08:00:00', '12:00:00', 1), (7, 1, '14:00:00', '18:00:00', 1), (7, 1, '19:00:00', '21:00:00', 1),
(7, 2, '08:00:00', '12:00:00', 1), (7, 2, '14:00:00', '18:00:00', 1), (7, 2, '19:00:00', '21:00:00', 1),
(7, 3, '08:00:00', '12:00:00', 1), (7, 3, '14:00:00', '18:00:00', 1), (7, 3, '19:00:00', '21:00:00', 1),
(7, 4, '08:00:00', '12:00:00', 1), (7, 4, '14:00:00', '18:00:00', 1), (7, 4, '19:00:00', '21:00:00', 1),
(7, 5, '08:00:00', '12:00:00', 1), (7, 5, '14:00:00', '18:00:00', 1), (7, 5, '19:00:00', '21:00:00', 1),
(7, 6, '08:00:00', '12:00:00', 1), (7, 6, '14:00:00', '18:00:00', 1), (7, 6, '19:00:00', '21:00:00', 1),
(7, 7, '08:00:00', '12:00:00', 1), (7, 7, '14:00:00', '18:00:00', 1), (7, 7, '19:00:00', '21:00:00', 1),

-- 健身房
(8, 1, '06:00:00', '12:00:00', 1), (8, 1, '14:00:00', '22:00:00', 1),
(8, 2, '06:00:00', '12:00:00', 1), (8, 2, '14:00:00', '22:00:00', 1),
(8, 3, '06:00:00', '12:00:00', 1), (8, 3, '14:00:00', '22:00:00', 1),
(8, 4, '06:00:00', '12:00:00', 1), (8, 4, '14:00:00', '22:00:00', 1),
(8, 5, '06:00:00', '12:00:00', 1), (8, 5, '14:00:00', '22:00:00', 1),
(8, 6, '06:00:00', '12:00:00', 1), (8, 6, '14:00:00', '22:00:00', 1),
(8, 7, '06:00:00', '12:00:00', 1), (8, 7, '14:00:00', '22:00:00', 1);

-- 插入教师信息
INSERT IGNORE INTO teachers (teacher_id, employee_id, name, title, department, phone, email, introduction) VALUES
('T001', 'T001', '张教练', '副教授', '体育学院', '13800138001', 'zhang@university.edu', '篮球专业教练，有15年教学经验'),
('T002', 'T002', '李老师', '讲师', '体育学院', '13800138002', 'li@university.edu', '足球专业教练，前职业球员'),
('T003', 'T003', '王师傅', '副教授', '体育学院', '13800138003', 'wang@university.edu', '武术大师，太极拳传承人'),
('T004', 'T004', '刘教练', '教授', '体育学院', '13800138004', 'liu@university.edu', '游泳专业教练，国家级裁判'),
('T005', 'T005', '陈老师', '讲师', '体育学院', '13800138005', 'chen@university.edu', '健身操专业教练，国际认证'),
('T006', 'T006', '赵教练', '副教授', '体育学院', '13800138006', 'zhao@university.edu', '网球专业教练，省队退役');

-- 同步 teacher_id 到 employee_id（处理已有数据）
UPDATE teachers SET employee_id = teacher_id WHERE employee_id IS NULL AND teacher_id IS NOT NULL;

-- 为教师创建用户账号
-- 密码: 123456
INSERT IGNORE INTO users (username, password, real_name, email, phone, user_type, teacher_id, created_at)
SELECT 
    teacher_id as username,
    '$2a$10$SATj4sfvUAntT5OIXvI7KOijHBTCsC1MsS7NmIdbdlOl3katzCsBS' as password,
    name as real_name,
    email,
    phone,
    'teacher' as user_type,
    id as teacher_id,
    NOW()
FROM teachers;

-- ================================
-- 插入系统配置参数
-- ================================

INSERT IGNORE INTO system_config (config_key, config_value, config_type, category, description, is_public) VALUES
-- 系统基本配置
('system_name', '体育选课系统', 'string', 'general', '系统名称', TRUE),
('system_version', '1.0.0', 'string', 'general', '系统版本', TRUE),
('school_name', '示例大学', 'string', 'general', '学校名称', TRUE),
('contact_email', 'admin@example.edu.cn', 'string', 'general', '系统联系邮箱', TRUE),
('contact_phone', '400-123-4567', 'string', 'general', '系统联系电话', TRUE),
('system_logo', '/images/logo.png', 'string', 'general', '系统Logo路径', TRUE),
('copyright_text', '© 2025 示例大学体育学院', 'string', 'general', '版权信息', TRUE),
('system_description', '体育选课管理系统，为学生提供便捷的体育课程选择服务', 'string', 'general', '系统描述', TRUE),

-- 选课管理配置
('selection_period_1_start', '2025-09-16 09:00:00', 'string', 'selection', '第一轮选课开始时间', TRUE),
('selection_period_1_end', '2025-09-20 18:00:00', 'string', 'selection', '第一轮选课结束时间', TRUE),
('makeup_selection_start', '2025-09-23 09:00:00', 'string', 'selection', '补退选开始时间', TRUE),
('makeup_selection_end', '2025-09-25 18:00:00', 'string', 'selection', '补退选结束时间', TRUE),
('max_credits_per_student', '4', 'number', 'selection', '每个学生最大选课学分', TRUE),
('max_courses_per_student', '2', 'number', 'selection', '每个学生最大选课门数', TRUE),
('selection_time_limit', '300', 'number', 'selection', '选课页面停留时间限制（秒）', FALSE),
('allow_course_drop', 'true', 'boolean', 'selection', '是否允许学生退课', TRUE),
('allow_course_change', 'true', 'boolean', 'selection', '是否允许学生改选', TRUE),
('selection_retry_limit', '3', 'number', 'selection', '选课失败重试次数限制', FALSE),
('lottery_processing_time', '2025-12-21 20:00:00', 'string', 'selection', '抽签处理时间', FALSE),
('auto_drop_expired_selections', 'true', 'boolean', 'selection', '自动清理过期选课记录', FALSE),
('selection_notification_enabled', 'true', 'boolean', 'selection', '选课结果通知开关', TRUE),

-- 安全设置
('password_min_length', '6', 'number', 'security', '密码最小长度', FALSE),
('password_max_length', '20', 'number', 'security', '密码最大长度', FALSE),
('password_require_number', 'true', 'boolean', 'security', '密码是否必须包含数字', FALSE),
('password_require_uppercase', 'false', 'boolean', 'security', '密码是否必须包含大写字母', FALSE),
('password_require_special', 'false', 'boolean', 'security', '密码是否必须包含特殊字符', FALSE),
('login_failure_limit', '5', 'number', 'security', '登录失败锁定次数', FALSE),
('login_lock_duration', '900', 'number', 'security', '登录锁定时长（秒）', FALSE),
('session_timeout', '3600', 'number', 'security', '会话超时时间（秒）', FALSE),
('force_password_change', 'false', 'boolean', 'security', '强制定期修改密码', FALSE),
('password_change_days', '90', 'number', 'security', '强制修改密码天数', FALSE),

-- 系统限制
('max_file_size', '10485760', 'number', 'limitation', '文件上传最大大小（字节）', FALSE),
('allowed_file_types', '["jpg", "jpeg", "png", "gif", "pdf", "doc", "docx", "xls", "xlsx"]', 'json', 'limitation', '允许上传的文件类型', FALSE),
('max_upload_files', '5', 'number', 'limitation', '单次最大上传文件数', FALSE),
('api_rate_limit', '100', 'number', 'limitation', 'API请求频率限制（每分钟）', FALSE),
('concurrent_users_limit', '1000', 'number', 'limitation', '并发用户数限制', FALSE),
('database_backup_enabled', 'true', 'boolean', 'limitation', '数据库自动备份开关', FALSE),
('log_retention_days', '30', 'number', 'limitation', '日志保留天数', FALSE),

-- 消息通知配置
('notification_enabled', 'true', 'boolean', 'notification', '系统通知总开关', TRUE),
('email_enabled', 'false', 'boolean', 'notification', '邮件通知开关', FALSE),
('email_smtp_host', 'smtp.example.com', 'string', 'notification', 'SMTP服务器地址', FALSE),
('email_smtp_port', '587', 'number', 'notification', 'SMTP端口', FALSE),
('email_username', '', 'string', 'notification', 'SMTP用户名', FALSE),
('email_password', '', 'string', 'notification', 'SMTP密码', FALSE),
('email_from_name', '体育选课系统', 'string', 'notification', '发件人名称', FALSE),
('sms_enabled', 'false', 'boolean', 'notification', '短信通知开关', FALSE),
('sms_provider', 'aliyun', 'string', 'notification', '短信服务商', FALSE),
('sms_template_id', '', 'string', 'notification', '短信模板ID', FALSE),
('browser_notification_enabled', 'true', 'boolean', 'notification', '浏览器通知开关', TRUE),

-- 外观设置
('theme_color', '#409EFF', 'string', 'appearance', '主题颜色', TRUE),
('page_size_default', '10', 'number', 'appearance', '默认分页大小', TRUE),
('language', 'zh-CN', 'string', 'appearance', '系统语言', TRUE),
('timezone', 'Asia/Shanghai', 'string', 'appearance', '时区设置', TRUE),
('date_format', 'YYYY-MM-DD', 'string', 'appearance', '日期格式', TRUE),
('time_format', 'HH:mm:ss', 'string', 'appearance', '时间格式', TRUE),
('show_welcome_guide', 'true', 'boolean', 'appearance', '显示新用户引导', TRUE),
('footer_links', '{"help": "/help", "about": "/about", "contact": "/contact"}', 'json', 'appearance', '页脚链接配置', TRUE),

-- 维护模式配置
('system_maintenance_mode', 'false', 'boolean', 'general', '系统维护模式', FALSE),
('maintenance_message', '系统正在维护升级中，预计30分钟后恢复正常，给您带来的不便敬请谅解。', 'string', 'general', '维护模式提示信息', FALSE),
('maintenance_start_time', '', 'string', 'general', '维护开始时间', FALSE),
('maintenance_end_time', '', 'string', 'general', '预计维护结束时间', FALSE),

-- 统计分析配置
('analytics_enabled', 'true', 'boolean', 'general', '统计分析开关', FALSE),
('visitor_tracking_enabled', 'true', 'boolean', 'general', '访客跟踪开关', FALSE),
('performance_monitoring', 'true', 'boolean', 'general', '性能监控开关', FALSE),
('error_reporting_enabled', 'true', 'boolean', 'general', '错误报告开关', FALSE),

-- 缓存配置
('cache_enabled', 'true', 'boolean', 'general', '缓存开关', FALSE),
('cache_ttl', '300', 'number', 'general', '缓存生存时间（秒）', FALSE),
('redis_enabled', 'false', 'boolean', 'general', 'Redis缓存开关', FALSE),

-- 课程管理配置
('course_auto_publish', 'false', 'boolean', 'selection', '课程自动发布', FALSE),
('course_capacity_warning_ratio', '0.9', 'number', 'selection', '课程容量预警比例', FALSE),
('course_evaluation_enabled', 'true', 'boolean', 'selection', '课程评价开关', TRUE),
('teacher_rating_enabled', 'true', 'boolean', 'selection', '教师评分开关', TRUE);

-- 插入示例学生用户
-- 密码: 123456
INSERT IGNORE INTO users (student_id, username, password, real_name, gender, email, phone, grade, major, class_name, user_type) VALUES
('2025001001', '2025001001', '$2a$10$SATj4sfvUAntT5OIXvI7KOijHBTCsC1MsS7NmIdbdlOl3katzCsBS', '张三', 'male', 'zhangsan@student.edu', '13900139001', '2025', '计算机科学与技术', '计科2501', 'student'),
('2025001002', '2025001002', '$2a$10$SATj4sfvUAntT5OIXvI7KOijHBTCsC1MsS7NmIdbdlOl3katzCsBS', '李四', 'male', 'lisi@student.edu', '13900139002', '2025', '软件工程', '软工2501', 'student'),
('2025001003', '2025001003', '$2a$10$SATj4sfvUAntT5OIXvI7KOijHBTCsC1MsS7NmIdbdlOl3katzCsBS', '王五', 'female', 'wangwu@student.edu', '13900139003', '2025', '信息安全', '信安2501', 'student'),
('2025001004', '2025001004', '$2a$10$SATj4sfvUAntT5OIXvI7KOijHBTCsC1MsS7NmIdbdlOl3katzCsBS', '赵六', 'male', 'zhaoliu@student.edu', '13900139004', '2025', '计算机科学与技术', '计科2502', 'student'),
('2025001005', '2025001005', '$2a$10$SATj4sfvUAntT5OIXvI7KOijHBTCsC1MsS7NmIdbdlOl3katzCsBS', '孙七', 'female', 'sunqi@student.edu', '13900139005', '2025', '数据科学', '数科2501', 'student');

-- 插入管理员用户
-- 密码: admin123
INSERT IGNORE INTO admin_users (username, password, real_name, email, role, status) VALUES
('admin', '$2a$10$ItX9fcnxrbQdRZLB/Z1NtuNZeG9QZuhdqqglxIm48SscDR77dfmk.', '系统管理员', 'admin@system.com', 'super_admin', 'active');

-- 插入选课配置
INSERT IGNORE INTO course_selection_config (semester, academic_year, round_number, round_name, selection_method, start_time, end_time, max_credits, max_courses, created_by) VALUES
('2026春', '2025-2026', 1, '第一轮选课', 'first_come', '2025-09-16 09:00:00', '2025-09-20 18:00:00', 2, 1, 1),
('2026春', '2025-2026', 2, '第二轮补选', 'lottery', '2025-09-23 09:00:00', '2025-09-25 18:00:00', 2, 1, 1);

-- 插入教师资质示例数据（使用employee_id查找对应的teacher id）
INSERT IGNORE INTO teacher_qualifications 
(teacher_id, sport_category, qualification_level, certificate_name, certificate_number, issue_date, expire_date, issuing_authority, description, is_active, verified_status, verified_by, verified_at) 
SELECT t.id, '篮球', '国家级', '国家一级篮球裁判员证书', 'NBR-2023-0001', '2023-01-15', '2028-01-15', '中国篮球协会', '具备执裁国家级篮球比赛资格', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T001'
UNION ALL
SELECT t.id, '篮球', '省级', '篮球教练员证书', 'PBC-2022-1234', '2022-06-20', '2027-06-20', '省体育局', '省级篮球教练员资格证书', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T001'
UNION ALL
SELECT t.id, '足球', '国家级', 'AFC C级教练员证书', 'AFC-C-2021-5678', '2021-09-10', '2026-09-10', '亚洲足球联合会', '亚足联C级教练员证书', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T002'
UNION ALL
SELECT t.id, '武术', '国家级', '武术六段证书', 'CWA-6-2020-0099', '2020-03-15', NULL, '中国武术协会', '国家武术六段资格', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T003'
UNION ALL
SELECT t.id, '游泳', '国家级', '游泳救生员证书', 'SWIM-2023-0456', '2023-05-01', '2026-05-01', '国家体育总局', '国家级游泳救生员资格', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T004'
UNION ALL
SELECT t.id, '健美操', '省级', '健美操指导员证书', 'AERO-2022-7890', '2022-11-20', '2025-11-20', '省健美操协会', '省级健美操指导员资格', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T005'
UNION ALL
SELECT t.id, '网球', '国家级', 'ITF一级教练员证书', 'ITF-L1-2021-3456', '2021-07-15', '2024-07-15', '国际网球联合会', 'ITF国际网球联合会一级教练员', 1, 'verified', (SELECT id FROM admin_users LIMIT 1), NOW()
FROM teachers t WHERE t.employee_id = 'T006';

-- 插入教师培训记录示例数据（使用employee_id查找对应的teacher id）
INSERT IGNORE INTO teacher_training_records 
(teacher_id, training_name, training_type, training_institution, training_start_date, training_end_date, training_hours, certificate_obtained, certificate_name, training_result) 
SELECT t.id, '篮球裁判员培训班', '专业培训', '中国篮球协会', '2023-01-01', '2023-01-15', 80, TRUE, '国家一级篮球裁判员证书', '优秀'
FROM teachers t WHERE t.employee_id = 'T001'
UNION ALL
SELECT t.id, '亚足联C级教练员培训', '专业培训', '亚洲足球联合会', '2021-08-01', '2021-09-10', 120, TRUE, 'AFC C级教练员证书', '良好'
FROM teachers t WHERE t.employee_id = 'T002'
UNION ALL
SELECT t.id, '传统武术教学法培训', '继续教育', '北京体育大学', '2022-07-10', '2022-07-20', 60, TRUE, '武术教学培训证书', '优秀'
FROM teachers t WHERE t.employee_id = 'T003'
UNION ALL
SELECT t.id, '游泳救生员资格培训', '岗前培训', '国家游泳中心', '2023-04-15', '2023-05-01', 40, TRUE, '游泳救生员证书', '合格'
FROM teachers t WHERE t.employee_id = 'T004'
UNION ALL
SELECT t.id, '健美操新编套路培训', '技能培训', '省体育学院', '2023-03-01', '2023-03-10', 30, FALSE, NULL, '良好'
FROM teachers t WHERE t.employee_id = 'T005';

-- ================================
-- 示例课程数据
-- ================================

-- 清空旧的课程数据（如果存在）
DELETE FROM courses WHERE course_code IN ('PE001', 'PE002', 'PE003', 'PE004', 'PE005', 'PE006', 'PE007', 'PE008', 'PE009');

-- 插入示例课程数据
INSERT INTO courses (course_code, name, category_id, teacher_id, venue_id, credits, capacity, day_of_week, start_time, end_time, weeks, semester, academic_year, syllabus, assessment_method, requirements, description, status, selection_start_time, selection_end_time) VALUES

-- 篮球课程
('PE001', '篮球基础', 1, 1, 1, 2, 30, 1, '14:00:00', '15:40:00', '1-16周', '2025秋', '2025-2026',
'本课程主要学习篮球基本技术，包括运球、投篮、传球、防守等基本动作，培养学生的篮球兴趣和基本技能。', 
'平时成绩60% + 期末技能测试40%', 
'身体健康，无心脏病等不适宜剧烈运动的疾病', 
'篮球是一项集体性、对抗性很强的运动项目，能够全面发展学生的身体素质，培养团队合作精神。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

('PE002', '篮球提高', 1, 1, 2, 2, 25, 3, '16:00:00', '17:40:00', '1-16周', '2025秋', '2025-2026',
'在掌握基本技术的基础上，学习篮球战术配合，提高比赛能力和篮球技战术水平。', 
'平时成绩50% + 技能测试30% + 比赛表现20%', 
'具备篮球基础，身体素质良好', 
'适合有一定篮球基础的学生，重点提高技战术水平和比赛能力。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

-- 足球课程
('PE003', '足球基础', 1, 2, 3, 2, 40, 2, '10:00:00', '11:40:00', '1-16周', '2025秋', '2025-2026',
'学习足球基本技术，包括颠球、传球、射门、头球等，了解足球规则和基本战术。', 
'平时成绩60% + 期末技能测试40%', 
'身体健康，适合户外运动', 
'足球是世界第一运动，能够提高学生的协调性、爆发力和团队协作能力。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

('PE004', '足球提高', 1, 2, 3, 2, 30, 4, '14:00:00', '15:40:00', '1-16周', '2025秋', '2025-2026',
'深入学习足球技战术，进行实战训练，提高比赛水平和足球素养。', 
'平时成绩40% + 技能测试40% + 比赛表现20%', 
'具备足球基础，体能良好', 
'适合有足球基础的学生，注重实战能力和战术素养的培养。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

-- 网球课程
('PE005', '网球入门', 1, 6, 4, 2, 20, 1, '08:00:00', '09:40:00', '1-16周', '2025秋', '2025-2026',
'学习网球基本技术，包括正手、反手、发球、截击等基本动作，了解网球规则。', 
'平时成绩70% + 期末技能测试30%', 
'身体健康，手臂无伤病', 
'网球是一项优雅的运动，能够提高学生的反应能力和身体协调性。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

('PE006', '网球提高', 1, 6, 5, 2, 18, 3, '08:00:00', '09:40:00', '1-16周', '2025秋', '2025-2026',
'在基础技术的基础上，学习网球战术和比赛技巧，提高网球竞技水平。', 
'平时成绩50% + 技能测试30% + 比赛表现20%', 
'具备网球基础，技术动作规范', 
'适合有网球基础的学生，重点提高比赛技巧和战术运用。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

-- 武术课程
('PE007', '太极拳', 3, 3, 7, 2, 35, 2, '08:00:00', '09:40:00', '1-16周', '2025秋', '2025-2026',
'学习太极拳基本套路，掌握太极拳的基本动作和呼吸方法，体验中华传统武术文化。', 
'平时成绩80% + 期末套路展示20%', 
'身体健康，对传统文化有兴趣', 
'太极拳是中华武术的瑰宝，具有强身健体、修身养性的功效。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

-- 游泳课程
('PE008', '游泳基础', 4, 4, 6, 2, 25, 4, '10:00:00', '11:40:00', '1-16周', '2025秋', '2025-2026',
'学习游泳基本技术，包括自由泳、蛙泳等泳姿，掌握水中安全知识。', 
'平时成绩60% + 技能测试40%', 
'身体健康，无皮肤病等不适宜游泳的疾病', 
'游泳是一项全身性运动，能够有效提高心肺功能和身体协调性。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00'),

-- 健身课程
('PE009', '健美操', 5, 5, 8, 2, 30, 5, '16:00:00', '17:40:00', '1-16周', '2025秋', '2025-2026',
'学习健美操基本动作，提高身体柔韧性和协调性，培养良好的体态。', 
'平时成绩70% + 期末展示30%', 
'身体健康，对健身运动有兴趣', 
'健美操是一项集健身、娱乐、表演于一体的运动项目。', 
'published', '2025-09-16 09:00:00', '2025-09-20 18:00:00');

-- 清空旧的选课记录
DELETE FROM course_selections;
DELETE FROM course_favorites;
DELETE FROM selection_history;
DELETE FROM attendance_records;
DELETE FROM grades;
DELETE FROM student_grades;
DELETE FROM special_applications;

-- 插入示例选课记录（使用学号查找对应的user_id）
INSERT INTO course_selections (user_id, course_id, status, selection_time)
SELECT u.id, 1, 'selected', '2025-09-16 10:30:00' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, 'selected', '2025-09-16 09:15:00' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, 'selected', '2025-09-16 11:20:00' FROM users u WHERE u.student_id = '2025001003' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, 'selected', '2025-09-16 13:45:00' FROM users u WHERE u.student_id = '2025001004' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, 'selected', '2025-09-16 14:10:00' FROM users u WHERE u.student_id = '2025001005' AND u.user_type = 'student'
UNION ALL
-- 其他课程的选课记录
SELECT u.id, 3, 'pending', '2025-09-16 11:00:00' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 2, 'selected', '2025-09-16 09:20:00' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 5, 'selected', '2025-09-16 12:30:00' FROM users u WHERE u.student_id = '2025001003' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 7, 'selected', '2025-09-16 15:00:00' FROM users u WHERE u.student_id = '2025001004' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 3, 'lottery', '2025-09-16 14:20:00' FROM users u WHERE u.student_id = '2025001005' AND u.user_type = 'student';

-- 更新课程已选人数
UPDATE courses c SET enrolled_count = (
    SELECT COUNT(*) FROM course_selections cs 
    WHERE cs.course_id = c.id AND cs.status = 'selected'
);

-- 插入示例收藏记录（使用学号查找对应的user_id）
INSERT INTO course_favorites (user_id, course_id)
SELECT u.id, 2 FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 4 FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 7 FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1 FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 3 FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 6 FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student';

-- 插入示例课程文件
INSERT INTO course_files (course_id, file_name, file_type, file_path, uploaded_by, description, is_public) VALUES
(1, '篮球教学大纲.pdf', 'syllabus', '/uploads/syllabus/basketball_syllabus.pdf', 1, '篮球基础课程教学大纲', TRUE),
(1, '篮球考核标准.pdf', 'assessment', '/uploads/assessment/basketball_assessment.pdf', 1, '篮球技能考核评分标准', TRUE),
(2, '篮球战术手册.pdf', 'material', '/uploads/materials/basketball_tactics.pdf', 1, '篮球基本战术配合', FALSE),
(3, '足球训练计划.pdf', 'syllabus', '/uploads/syllabus/football_syllabus.pdf', 2, '足球基础训练大纲', TRUE),
(7, '太极拳套路图解.pdf', 'material', '/uploads/materials/taichi_manual.pdf', 3, '24式太极拳动作图解', TRUE);

-- 插入示例考勤记录（使用学号查找对应的student_id，recorded_by使用教师的user_id）
INSERT INTO attendance_records (student_id, course_id, class_date, status, notes, recorded_by)
SELECT u.id, 1, '2025-09-23', 'present', '表现积极', (SELECT id FROM users WHERE username = 'T001' LIMIT 1) FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, '2025-09-23', 'present', '技术进步明显', (SELECT id FROM users WHERE username = 'T001' LIMIT 1) FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, '2025-09-30', 'late', '迟到5分钟', (SELECT id FROM users WHERE username = 'T001' LIMIT 1) FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, '2025-09-30', 'present', '准时到达', (SELECT id FROM users WHERE username = 'T001' LIMIT 1) FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 3, '2025-09-24', 'present', '训练认真', (SELECT id FROM users WHERE username = 'T002' LIMIT 1) FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 2, '2025-09-25', 'absent', '请假', (SELECT id FROM users WHERE username = 'T001' LIMIT 1) FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student';

-- 插入示例成绩记录（使用学号和教师ID）
INSERT INTO grades (student_id, course_id, teacher_id, attendance_score, final_score, total_score, grade_level, remarks)
SELECT u.id, 1, 1, 85.0, 90.0, 87.5, '良好', '技术掌握较好，需加强体能训练' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 1, 1, 90.0, 85.0, 87.5, '良好', '出勤率高，技术有待提高' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 3, 2, 88.0, 92.0, 90.0, '优秀', '足球天赋突出，战术理解能力强' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 2, 1, 82.0, 88.0, 85.0, '良好', '进步明显，继续努力' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student';

-- 插入示例学生成绩记录（新版成绩表）
-- 为PE001课程（ID=1）插入所有选课学生的成绩
INSERT INTO student_grades (course_id, student_id, attendance_score, performance_score, midterm_score, final_score, total_score, grade_level, semester, academic_year, is_submitted, remarks)
SELECT 
    1, 
    cs.user_id,
    CASE 
        WHEN u.student_id = '2025001001' THEN 90.0
        WHEN u.student_id = '2025001002' THEN 95.0
        WHEN u.student_id = '2025001003' THEN 88.0
        WHEN u.student_id = '2025001004' THEN 78.0
        WHEN u.student_id = '2025001005' THEN 65.0
        WHEN u.student_id = '2025001006' THEN 92.0
        WHEN u.student_id = '2025001007' THEN 83.0
        WHEN u.student_id = '2025001008' THEN 70.0
        ELSE 85.0
    END as attendance_score,
    CASE 
        WHEN u.student_id = '2025001001' THEN 85.0
        WHEN u.student_id = '2025001002' THEN 90.0
        WHEN u.student_id = '2025001003' THEN 92.0
        WHEN u.student_id = '2025001004' THEN 75.0
        WHEN u.student_id = '2025001005' THEN 60.0
        WHEN u.student_id = '2025001006' THEN 88.0
        WHEN u.student_id = '2025001007' THEN 80.0
        WHEN u.student_id = '2025001008' THEN 68.0
        ELSE 82.0
    END as performance_score,
    CASE 
        WHEN u.student_id = '2025001001' THEN 88.0
        WHEN u.student_id = '2025001002' THEN 85.0
        WHEN u.student_id = '2025001003' THEN 90.0
        WHEN u.student_id = '2025001004' THEN 70.0
        WHEN u.student_id = '2025001005' THEN 55.0
        WHEN u.student_id = '2025001006' THEN 91.0
        WHEN u.student_id = '2025001007' THEN 78.0
        WHEN u.student_id = '2025001008' THEN 65.0
        ELSE 83.0
    END as midterm_score,
    CASE 
        WHEN u.student_id = '2025001001' THEN 92.0
        WHEN u.student_id = '2025001002' THEN 88.0
        WHEN u.student_id = '2025001003' THEN 94.0
        WHEN u.student_id = '2025001004' THEN 72.0
        WHEN u.student_id = '2025001005' THEN 58.0
        WHEN u.student_id = '2025001006' THEN 93.0
        WHEN u.student_id = '2025001007' THEN 82.0
        WHEN u.student_id = '2025001008' THEN 66.0
        ELSE 85.0
    END as final_score,
    CASE 
        WHEN u.student_id = '2025001001' THEN 88.5
        WHEN u.student_id = '2025001002' THEN 89.3
        WHEN u.student_id = '2025001003' THEN 91.0
        WHEN u.student_id = '2025001004' THEN 73.8
        WHEN u.student_id = '2025001005' THEN 59.5
        WHEN u.student_id = '2025001006' THEN 91.0
        WHEN u.student_id = '2025001007' THEN 80.8
        WHEN u.student_id = '2025001008' THEN 67.3
        ELSE 83.8
    END as total_score,
    CASE 
        WHEN u.student_id = '2025001001' THEN 'B'
        WHEN u.student_id = '2025001002' THEN 'B'
        WHEN u.student_id = '2025001003' THEN 'A'
        WHEN u.student_id = '2025001004' THEN 'C'
        WHEN u.student_id = '2025001005' THEN 'F'
        WHEN u.student_id = '2025001006' THEN 'A'
        WHEN u.student_id = '2025001007' THEN 'B'
        WHEN u.student_id = '2025001008' THEN 'D'
        ELSE 'B'
    END as grade_level,
    '2025秋',
    '2025-2026',
    TRUE,  -- 已提交
    CASE 
        WHEN u.student_id = '2025001001' THEN '表现良好，技术进步明显'
        WHEN u.student_id = '2025001002' THEN '出勤优秀，期末有所进步'
        WHEN u.student_id = '2025001003' THEN '各方面表现优秀'
        WHEN u.student_id = '2025001004' THEN '需要加强练习'
        WHEN u.student_id = '2025001005' THEN '建议重修'
        WHEN u.student_id = '2025001006' THEN '成绩优异，值得表扬'
        WHEN u.student_id = '2025001007' THEN '稳定发挥，保持努力'
        WHEN u.student_id = '2025001008' THEN '有待提高，需多加练习'
        ELSE '正常完成课程要求'
    END as remarks
FROM course_selections cs
JOIN users u ON cs.user_id = u.id
WHERE cs.course_id = 1 AND cs.status = 'selected';

-- 为其他课程添加少量成绩记录
INSERT INTO student_grades (course_id, student_id, attendance_score, performance_score, midterm_score, final_score, total_score, grade_level, semester, academic_year, remarks)
SELECT 2, u.id, 85.0, 80.0, 75.0, 82.0, 80.5, 'B', '2025秋', '2025-2026', '保持稳定发挥' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT 3, u.id, 92.0, 88.0, 90.0, 85.0, 88.4, 'B', '2025秋', '2025-2026', '理论扎实，实践需加强' FROM users u WHERE u.student_id = '2025001004' AND u.user_type = 'student';

-- 插入示例特殊申请（使用学号查找对应的student_id）
INSERT INTO special_applications (student_id, course_id, request_type, reason, status, teacher_comment)
SELECT u.id, 1, 'injury', '膝盖受伤，无法参加篮球课程', 'approved', '同意申请，注意休息恢复' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 3, 'medical', '心脏不适，不宜进行高强度运动', 'pending', NULL FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student';

-- 插入示例课程公告
INSERT INTO course_announcements (course_id, teacher_id, title, content, is_important) VALUES
(1, 1, '篮球课程注意事项', '请同学们准备好运动服装和篮球鞋，课程将在体育馆进行。注意安全，做好热身运动。', FALSE),
(1, 1, '重要：下周课程调整', '由于场地维修，下周一篮球课改为理论课，地点：教学楼A201。请准时参加。', TRUE),
(3, 2, '足球训练安全提醒', '天气转凉，请注意保暖。训练前务必做好充分的热身运动，避免运动伤害。', FALSE),
(7, 3, '太极拳文化讲座', '本周五下午将举办太极拳文化专题讲座，欢迎感兴趣的同学参加。', FALSE);

-- 插入选课历史记录（使用学号查找对应的user_id）
INSERT INTO selection_history (user_id, course_id, action, semester, academic_year, remarks)
SELECT u.id, 1, 'select', '2026春', '2025-2026', '第一轮选课成功' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 2, 'lottery_lose', '2026春', '2025-2026', '抽签未中' FROM users u WHERE u.student_id = '2025001001' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 2, 'select', '2026春', '2025-2026', '第一轮选课成功' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student'
UNION ALL
SELECT u.id, 4, 'drop', '2026春', '2025-2026', '主动退选' FROM users u WHERE u.student_id = '2025001002' AND u.user_type = 'student';

-- 管理员操作日志表
CREATE TABLE IF NOT EXISTS admin_operation_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    admin_id INT COMMENT '管理员ID',
    operation_type VARCHAR(50) COMMENT '操作类型',
    operation_module VARCHAR(50) COMMENT '操作模块',
    operation_description TEXT COMMENT '操作描述',
    target_type VARCHAR(50) COMMENT '目标类型',
    target_id INT COMMENT '目标ID',
    old_data JSON COMMENT '旧数据',
    new_data JSON COMMENT '新数据',
    ip_address VARCHAR(45) COMMENT 'IP地址',
    user_agent TEXT COMMENT '用户代理',
    result VARCHAR(20) DEFAULT 'SUCCESS' COMMENT '操作结果',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admin_id (admin_id),
    INDEX idx_operation_type (operation_type),
    INDEX idx_created_at (created_at)
) COMMENT '管理员操作日志表';

-- ================================
-- 紧急处理功能相关表
-- ================================

-- 选课统计表（用于系统性能监控）
CREATE TABLE IF NOT EXISTS selection_statistics (
    id INT PRIMARY KEY AUTO_INCREMENT,
    concurrent_users INT DEFAULT 0 COMMENT '并发用户数',
    response_time DECIMAL(10,2) DEFAULT 0 COMMENT '平均响应时间(毫秒)',
    system_load DECIMAL(5,2) DEFAULT 0 COMMENT '系统负载',
    memory_usage DECIMAL(5,2) DEFAULT 0 COMMENT '内存使用率(%)',
    cpu_usage DECIMAL(5,2) DEFAULT 0 COMMENT 'CPU使用率(%)',
    selection_count INT DEFAULT 0 COMMENT '选课操作次数',
    error_count INT DEFAULT 0 COMMENT '错误次数',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_created_at (created_at)
) COMMENT '选课统计表';

-- 系统异常事件表
CREATE TABLE IF NOT EXISTS system_incidents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    incident_type ENUM('system_error', 'data_inconsistency', 'performance_issue', 'security_alert', 'maintenance', 'other') NOT NULL COMMENT '事件类型',
    severity ENUM('low', 'medium', 'high', 'critical') NOT NULL COMMENT '严重程度',
    title VARCHAR(200) NOT NULL COMMENT '事件标题',
    description TEXT COMMENT '事件描述',
    affected_module VARCHAR(100) COMMENT '受影响模块',
    error_message TEXT COMMENT '错误信息',
    assigned_to INT COMMENT '分配处理人员',
    resolution_status ENUM('open', 'investigating', 'in_progress', 'resolved', 'closed') DEFAULT 'open' COMMENT '解决状态',
    resolution_notes TEXT COMMENT '解决说明',
    resolved_at TIMESTAMP NULL COMMENT '解决时间',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES admin_users(id) ON DELETE SET NULL,
    INDEX idx_incident_type (incident_type),
    INDEX idx_severity (severity),
    INDEX idx_resolution_status (resolution_status),
    INDEX idx_created_at (created_at)
) COMMENT '系统异常事件表';

-- 系统通知表
CREATE TABLE IF NOT EXISTS system_notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    notification_type ENUM('system', 'emergency', 'maintenance', 'announcement', 'reminder') NOT NULL COMMENT '通知类型',
    target_type ENUM('all', 'students', 'teachers', 'admins', 'specific_users') NOT NULL COMMENT '目标用户类型',
    target_users JSON COMMENT '特定目标用户ID列表（当target_type为specific_users时使用）',
    title VARCHAR(200) NOT NULL COMMENT '通知标题',
    content TEXT NOT NULL COMMENT '通知内容',
    priority ENUM('low', 'normal', 'high', 'urgent') DEFAULT 'normal' COMMENT '优先级',
    is_published BOOLEAN DEFAULT FALSE COMMENT '是否已发布',
    publish_time TIMESTAMP NULL COMMENT '发布时间',
    expire_time TIMESTAMP NULL COMMENT '过期时间',
    read_count INT DEFAULT 0 COMMENT '阅读次数',
    created_by INT NOT NULL COMMENT '创建者',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE CASCADE,
    INDEX idx_notification_type (notification_type),
    INDEX idx_target_type (target_type),
    INDEX idx_priority (priority),
    INDEX idx_is_published (is_published),
    INDEX idx_publish_time (publish_time),
    INDEX idx_created_at (created_at)
) COMMENT '系统通知表';

-- 系统监控日志表
CREATE TABLE IF NOT EXISTS system_monitoring_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    metric_type ENUM('cpu', 'memory', 'disk', 'network', 'database', 'response_time', 'concurrent_users') NOT NULL COMMENT '监控指标类型',
    metric_value DECIMAL(10,2) NOT NULL COMMENT '指标值',
    metric_unit VARCHAR(20) COMMENT '单位',
    status ENUM('normal', 'warning', 'critical') DEFAULT 'normal' COMMENT '状态',
    threshold_warning DECIMAL(10,2) COMMENT '警告阈值',
    threshold_critical DECIMAL(10,2) COMMENT '严重阈值',
    server_info JSON COMMENT '服务器信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_metric_type (metric_type),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) COMMENT '系统监控日志表';


-- ================================
-- 插入示例数据
-- ================================

-- 插入示例监控数据（避免查询空表）
INSERT IGNORE INTO selection_statistics (concurrent_users, response_time, system_load, memory_usage, cpu_usage, selection_count, error_count) VALUES
(15, 250.5, 0.65, 45.2, 25.8, 120, 2),
(22, 180.3, 0.72, 52.1, 31.4, 95, 1),
(18, 320.1, 0.58, 41.8, 28.9, 87, 0),
(25, 195.7, 0.81, 58.3, 35.2, 156, 3);

-- 插入示例系统事件
INSERT IGNORE INTO system_incidents (incident_type, severity, title, description, resolution_status) VALUES
('system_error', 'medium', '数据库连接超时', '部分用户反馈选课页面加载缓慢', 'resolved'),
('performance_issue', 'low', '响应时间偏高', '系统响应时间在高峰期超过500ms', 'investigating');

-- 教师资质数据已在上方插入，此处删除重复数据

-- 插入资质申请记录（使用employee_id查找对应的teacher id）
INSERT INTO teacher_qualification_applications (
    teacher_id,
    sport_category,
    qualification_level,
    certificate_name,
    certificate_number,
    issue_date,
    expire_date,
    issuing_authority,
    description,
    attachment_url,
    application_status,
    review_notes
)
SELECT t.id, '乒乓球', '省级', '省级乒乓球教练员证书', 'PTT-2024-009', '2024-01-10', '2027-01-10', '省乒乓球协会', '申请省级乒乓球教练员资格认证', '/uploads/certificates/ptt-cert.pdf', 'pending', NULL
FROM teachers t WHERE t.employee_id = 'T001'
UNION ALL
SELECT t.id, '篮球', '市级', '市级篮球裁判员证书', 'CBR-2024-010', '2024-02-01', '2026-02-01', '市篮球协会', '申请市级篮球裁判员资格', '/uploads/certificates/cbr-cert.pdf', 'approved', '资料完整，审核通过'
FROM teachers t WHERE t.employee_id = 'T002';

-- 插入培训记录（暂时注释，因为依赖动态生成的qualification_id）
-- 如需要可在实际使用中手动添加
-- INSERT INTO teacher_training_records (
--     teacher_id,
--     qualification_id,
--     training_name,
--     training_type,
--     training_date,
--     training_hours,
--     training_institution,
--     certificate_number,
--     description
-- ) VALUES
-- (teacher_id, qualification_id, '国家级篮球裁判员培训', '专业培训', '2023-01-10', 120, '中国篮球协会', 'NBT-2023-001', '完成国家级篮球裁判员培训课程'),
-- (teacher_id, qualification_id, '足球教练员继续教育', '继续教育', '2023-10-15', 40, '中国足协', 'FCE-2023-002', '完成年度继续教育要求'),
-- (teacher_id, qualification_id, '游泳救生员技能培训', '技能培训', '2023-02-20', 100, '国家游泳管理中心', 'LST-2023-003', '游泳救生专项技能培训');

-- 插入审核日志（暂时注释，因为依赖动态生成的qualification_id）
-- 如需要可在实际使用中手动添加
-- INSERT INTO qualification_review_logs (
--     qualification_id,
--     reviewer_id,
--     action,
--     review_result,
--     review_notes
-- ) VALUES
-- (qualification_id, 1, 'verify', 'approved', '资质材料完整，审核通过'),
-- (qualification_id, 1, 'verify', 'approved', '符合要求，审核通过'),
-- (qualification_id, 1, 'verify', 'approved', '资质有效，审核通过'),
-- (qualification_id, 1, 'review', 'pending', '材料已收到，等待进一步审核');

-- 更新管理员权限配置（添加教师资质管理权限）
UPDATE admin_users 
SET permissions = JSON_SET(
    COALESCE(permissions, '{}'),
    '$.teacher_qualification_management', true
)
WHERE role IN ('super_admin', 'admin');

-- ================================
-- 成绩统计视图
-- ================================

-- 创建成绩统计视图
CREATE OR REPLACE VIEW grade_statistics_view AS
SELECT 
    sg.course_id,
    sg.semester,
    sg.academic_year,
    COUNT(DISTINCT sg.student_id) as total_students,
    COUNT(CASE WHEN sg.total_score IS NOT NULL THEN 1 END) as graded_students,
    AVG(sg.total_score) as average_score,
    MAX(sg.total_score) as highest_score,
    MIN(sg.total_score) as lowest_score,
    STD(sg.total_score) as score_std_dev,
    -- 等级分布
    COUNT(CASE WHEN sg.grade_level = 'A' THEN 1 END) as grade_a_count,
    COUNT(CASE WHEN sg.grade_level = 'B' THEN 1 END) as grade_b_count,
    COUNT(CASE WHEN sg.grade_level = 'C' THEN 1 END) as grade_c_count,
    COUNT(CASE WHEN sg.grade_level = 'D' THEN 1 END) as grade_d_count,
    COUNT(CASE WHEN sg.grade_level = 'F' THEN 1 END) as grade_f_count,
    -- 分数段分布
    COUNT(CASE WHEN sg.total_score >= 90 THEN 1 END) as score_90_100,
    COUNT(CASE WHEN sg.total_score >= 80 AND sg.total_score < 90 THEN 1 END) as score_80_89,
    COUNT(CASE WHEN sg.total_score >= 70 AND sg.total_score < 80 THEN 1 END) as score_70_79,
    COUNT(CASE WHEN sg.total_score >= 60 AND sg.total_score < 70 THEN 1 END) as score_60_69,
    COUNT(CASE WHEN sg.total_score < 60 AND sg.total_score IS NOT NULL THEN 1 END) as score_below_60,
    -- 及格和优秀统计
    COUNT(CASE WHEN sg.total_score >= 60 THEN 1 END) as pass_count,
    COUNT(CASE WHEN sg.total_score >= 80 THEN 1 END) as excellent_count,
    COUNT(CASE WHEN sg.total_score >= 60 THEN 1 END) / NULLIF(COUNT(CASE WHEN sg.total_score IS NOT NULL THEN 1 END), 0) as pass_rate,
    COUNT(CASE WHEN sg.total_score >= 80 THEN 1 END) / NULLIF(COUNT(CASE WHEN sg.total_score IS NOT NULL THEN 1 END), 0) as excellent_rate,
    COUNT(CASE WHEN sg.is_submitted = TRUE THEN 1 END) as submitted_count
FROM student_grades sg
GROUP BY sg.course_id, sg.semester, sg.academic_year;

-- 创建课程成绩详细视图
CREATE OR REPLACE VIEW course_grade_details AS
SELECT 
    c.id as course_id,
    c.course_code,
    c.name as course_name,
    c.teacher_id,
    t.name as teacher_name,
    u.id as student_id,
    u.student_id as student_number,
    u.real_name as student_name,
    u.grade as student_grade,
    u.major as student_major,
    u.class_name as student_class,
    sg.attendance_score,
    sg.performance_score,
    sg.midterm_score,
    sg.final_score,
    sg.total_score,
    sg.grade_level,
    sg.semester,
    sg.academic_year,
    sg.is_submitted,
    sg.submit_time,
    sg.remarks,
    sg.created_at,
    sg.updated_at
FROM courses c
JOIN teachers t ON c.teacher_id = t.id
JOIN course_selections cs ON cs.course_id = c.id AND cs.status = 'selected'
JOIN users u ON cs.user_id = u.id
LEFT JOIN student_grades sg ON sg.course_id = c.id AND sg.student_id = u.id;

-- 创建教师课程成绩汇总视图
CREATE OR REPLACE VIEW teacher_course_summary AS
SELECT 
    t.id as teacher_id,
    t.name as teacher_name,
    t.employee_id,
    c.id as course_id,
    c.course_code,
    c.name as course_name,
    c.semester,
    c.academic_year,
    COUNT(DISTINCT cs.user_id) as total_enrolled,
    COUNT(DISTINCT sg.student_id) as total_graded,
    AVG(sg.total_score) as avg_score,
    MIN(sg.total_score) as min_score,
    MAX(sg.total_score) as max_score,
    COUNT(CASE WHEN sg.total_score >= 60 THEN 1 END) as pass_count,
    COUNT(CASE WHEN sg.total_score >= 60 THEN 1 END) / NULLIF(COUNT(CASE WHEN sg.total_score IS NOT NULL THEN 1 END), 0) * 100 as pass_rate_percentage
FROM teachers t
JOIN courses c ON c.teacher_id = t.id
LEFT JOIN course_selections cs ON cs.course_id = c.id AND cs.status = 'selected'
LEFT JOIN student_grades sg ON sg.course_id = c.id AND sg.student_id = cs.user_id
GROUP BY t.id, c.id;

-- 创建索引以优化查询性能
CREATE INDEX idx_sg_course_semester ON student_grades(course_id, semester, academic_year);
CREATE INDEX idx_sg_total_score ON student_grades(total_score);
CREATE INDEX idx_sg_grade_level ON student_grades(grade_level);

COMMIT;
